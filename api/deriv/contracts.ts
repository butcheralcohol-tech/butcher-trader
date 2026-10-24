import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocket } from "ws";
import { OAUTH_COOKIE, decryptSession, parseCookies } from "../../shared/oauth-session.js";

type Reply = {
  req_id?: number;
  error?: { code?: string; message?: string };
  contracts_for?: { available?: Array<Record<string, unknown>> };
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(body));
}

async function requestContracts(
  token: string,
  accountId: string,
  symbol: string,
): Promise<Array<Record<string, unknown>>> {
  const appId = process.env.DERIV_APP_ID?.trim();
  if (!appId || !/^\d+$/.test(appId)) {
    throw new Error("Server-side DERIV_APP_ID is not configured.");
  }

  // Step 1: Mint a one-time WebSocket URL via the OTP endpoint.
  // contracts_for itself requires no auth, but we still authenticate so
  // Deriv returns only contracts the account is actually eligible for.
  const otpResponse = await fetch(
    `https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Deriv-App-ID": appId,
      },
      signal: AbortSignal.timeout(8000),
    },
  );

  if (!otpResponse.ok) {
    const body = await otpResponse.text();
    throw new Error(`Deriv OTP request rejected (${otpResponse.status}). ${body.slice(0, 200)}`);
  }

  const otpPayload = (await otpResponse.json()) as { data?: { url?: string } };
  const wsUrl = otpPayload.data?.url;
  if (!wsUrl || !wsUrl.startsWith("wss://")) {
    throw new Error("Deriv OTP response did not contain a secure WebSocket URL.");
  }

  const ws = new WebSocket(wsUrl);

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Deriv WebSocket timed out.")), 8000);
      ws.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.once("error", () => {
        clearTimeout(timeout);
        reject(new Error("Deriv WebSocket connection failed."));
      });
    });

    let nextId = 1;
    const send = (payload: Record<string, unknown>) =>
      new Promise<Reply>((resolve, reject) => {
        const req_id = nextId++;
        const timeout = setTimeout(() => {
          ws.off("message", onMessage);
          reject(new Error("Deriv response timed out."));
        }, 10000);

        const onMessage = (data: WebSocket.RawData) => {
          let message: Reply;
          try {
            message = JSON.parse(data.toString()) as Reply;
          } catch {
            return;
          }
          if (message.req_id !== req_id) return;
          clearTimeout(timeout);
          ws.off("message", onMessage);
          if (message.error) {
            reject(
              new Error(
                "Deriv rejected contract discovery (" + (message.error.code || "API_ERROR") + ").",
              ),
            );
          } else {
            resolve(message);
          }
        };

        ws.on("message", onMessage);
        ws.send(JSON.stringify({ ...payload, req_id }), (error) => {
          if (error) {
            clearTimeout(timeout);
            ws.off("message", onMessage);
            reject(new Error("Could not send request to Deriv."));
          }
        });
      });

    // The OTP URL is already authenticated. No `authorize` message is sent.
    // contracts_for no longer accepts currency, product_type, loginid, or
    // landing_company parameters — those were removed in the current API [citation:1].
    const result = await send({ contracts_for: symbol });

    const contracts = result.contracts_for?.available;
    if (!Array.isArray(contracts)) {
      throw new Error("Deriv did not return available contracts for this market.");
    }

    return contracts;
  } finally {
    try {
      ws.close();
    } catch {
      /* best effort */
    }
  }
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  const session = decryptSession(
    parseCookies(typeof req.headers.cookie === "string" ? req.headers.cookie : null)[OAUTH_COOKIE],
    process.env.SESSION_SECRET ?? "",
  );
  if (!session) {
    sendJson(res, 401, { error: "Connect Deriv before discovering available contracts." });
    return;
  }

  const requestUrl = new URL(req.url || "/", "https://local.invalid");
  const rawSymbol = requestUrl.searchParams.get("symbol") || "";
  const symbol = rawSymbol.trim();
  if (!/^[A-Z0-9_]{2,32}$/.test(symbol)) {
    sendJson(res, 400, { error: "A valid market symbol is required." });
    return;
  }

  const accountId = requestUrl.searchParams.get("accountId")?.trim() ?? "";
  if (!accountId || !/^[A-Z]{2,4}\d+$/i.test(accountId)) {
    sendJson(res, 400, { error: "A valid accountId is required." });
    return;
  }

  try {
    const contracts = await requestContracts(session.accessToken, accountId, symbol);

    const mapped = contracts
      .map((contract) => ({
        contractType:
          typeof contract.contract_type === "string" ? contract.contract_type : "",
        category:
          typeof contract.contract_category === "string" ? contract.contract_category : "",
        // contract_display and contract_category_display were removed from the
        // response in the current API. Fall back to contract_type so the UI
        // still has a label [citation:1].
        label:
          typeof contract.contract_type === "string" ? contract.contract_type : "",
        barriers: contract.barriers ?? null,
        sentiment: contract.sentiment ?? null,
        // barrier_category and start_type were removed in the current API.
        // Keep the keys for backward compatibility but always null [citation:1].
        barrierCategory: null,
        startType: null,
        expiryType: contract.expiry_type ?? null,
        minDuration: contract.min_contract_duration ?? null,
        maxDuration: contract.max_contract_duration ?? null,
        multiplierRange: contract.multiplier_range ?? null,
      }))
      .filter((contract) => contract.contractType);

    sendJson(res, 200, {
      mode: "demo",
      account: accountId,
      symbol,
      contracts: mapped,
    });
  } catch (error) {
    sendJson(res, 503, {
      error: error instanceof Error ? error.message : "Contract discovery failed closed.",
    });
  }
}

import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocket } from "ws";
import { OAUTH_COOKIE, decryptSession, parseCookies } from "../../shared/oauth-session.js";

type Reply = {
  req_id?: number;
  error?: { code?: string; message?: string };
  authorize?: { loginid?: string; is_virtual?: number };
  proposal_open_contract?: {
    contract_id?: number; status?: string; is_sold?: number; is_expired?: number;
    buy_price?: number; sell_price?: number; profit?: number; payout?: number;
    currency?: string; date_start?: number; date_expiry?: number; transaction_ids?: { buy?: number; sell?: number };
  };
};
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(body));
};
async function redisCommand<T>(command: (string | number)[]): Promise<T | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) throw new Error("Durable order storage is unavailable.");
  const response = await fetch(url, { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Durable order storage is unavailable.");
  const result = await response.json() as { result?: T; error?: string };
  if (result.error) throw new Error("Durable order storage rejected the request.");
  return result.result ?? null;
}
async function requestContract(token: string, contractId: number): Promise<Reply> {
  const appId = process.env.DERIV_APP_ID?.trim();
  if (!appId || !/^\d+$/.test(appId)) throw new Error("Server-side Deriv app configuration is missing.");
  const endpoint = process.env.DERIV_TRADING_WS_URL?.trim() ||
    `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`;
  if (!endpoint.startsWith("wss://")) throw new Error("Deriv endpoint must use secure WebSocket.");
  const ws = new WebSocket(endpoint);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Deriv connection timed out.")), 8000);
      ws.once("open", () => { clearTimeout(timer); resolve(); });
      ws.once("error", () => { clearTimeout(timer); reject(new Error("Deriv connection failed.")); });
    });
    let id = 1;
    const send = (payload: Record<string, unknown>) => new Promise<Reply>((resolve, reject) => {
      const req_id = id++;
      const timer = setTimeout(() => { ws.off("message", onMessage); reject(new Error("Deriv contract status timed out; retry status lookup, not the order.")); }, 10000);
      const onMessage = (raw: WebSocket.RawData) => {
        let message: Reply;
        try { message = JSON.parse(raw.toString()) as Reply; } catch { return; }
        if (message.req_id !== req_id) return;
        clearTimeout(timer); ws.off("message", onMessage);
        if (message.error) reject(new Error(`Deriv rejected status lookup (${message.error.code ?? "API_ERROR"}).`));
        else resolve(message);
      };
      ws.on("message", onMessage);
      ws.send(JSON.stringify({ ...payload, req_id }), error => {
        if (error) { clearTimeout(timer); ws.off("message", onMessage); reject(new Error("Could not request contract status.")); }
      });
    });
    const auth = await send({ authorize: token });
    if (!auth.authorize || auth.authorize.is_virtual !== 1 || !/^VRTC\d+$/.test(String(auth.authorize.loginid ?? ""))) {
      throw new Error("Only the authenticated Deriv virtual account can be reconciled.");
    }
    const status = await send({ proposal_open_contract: 1, contract_id: contractId });
    if (!status.proposal_open_contract || Number(status.proposal_open_contract.contract_id) !== contractId) {
      throw new Error("Deriv did not return the requested contract.");
    }
    return { ...status, authorize: auth.authorize };
  } finally { try { ws.close(); } catch { /* best effort */ } }
}
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); json(res, 405, { error: "Method not allowed." }); return; }
  const session = decryptSession(parseCookies(typeof req.headers.cookie === "string" ? req.headers.cookie : null)[OAUTH_COOKIE],
    process.env.SESSION_SECRET ?? "");
  if (!session) { json(res, 401, { error: "Connect Deriv before checking order status." }); return; }
  const rawId = new URL(req.url ?? "/", "https://internal.invalid").searchParams.get("contractId") ?? "";
  if (!/^\d{1,20}$/.test(rawId) || Number(rawId) <= 0 || !Number.isSafeInteger(Number(rawId))) {
    json(res, 400, { error: "A valid contractId is required." }); return;
  }
  const contractId = Number(rawId);
  try {
    const authCheck = await requestContract(session.accessToken, contractId);
    const loginid = String(authCheck.authorize?.loginid ?? "");
    const key = `butcher:demo:${loginid}:contract:${contractId}`;
    const stored = await redisCommand<string>(["GET", key]);
    if (!stored) { json(res, 404, { error: "This contract is not in the application's demo order ledger." }); return; }
    const previous = JSON.parse(stored) as Record<string, unknown>;
    if (previous.account !== loginid || previous.mode !== "demo") {
      json(res, 403, { error: "Contract/account ownership could not be verified." }); return;
    }
    const c = authCheck.proposal_open_contract!;
    const sold = c.is_sold === 1 || c.is_expired === 1;
    const profit = typeof c.profit === "number" && Number.isFinite(c.profit) ? c.profit : null;
    const settlement = {
      ...previous,
      status: sold ? "settled" : (typeof c.status === "string" ? c.status : "open"),
      contractStatus: typeof c.status === "string" ? c.status : "unknown",
      isSold: sold,
      buyPrice: typeof c.buy_price === "number" ? c.buy_price : previous.stake,
      sellPrice: typeof c.sell_price === "number" ? c.sell_price : null,
      profit,
      payout: typeof c.payout === "number" ? c.payout : null,
      currency: typeof c.currency === "string" ? c.currency : previous.currency,
      startedAt: typeof c.date_start === "number" ? new Date(c.date_start * 1000).toISOString() : null,
      expiresAt: typeof c.date_expiry === "number" ? new Date(c.date_expiry * 1000).toISOString() : null,
      sellTransactionId: c.transaction_ids?.sell ?? null,
      settlementSource: "deriv_proposal_open_contract",
      reconciledAt: new Date().toISOString(),
      brokerConfirmed: true,
      liveTradingEnabled: false
    };
    await redisCommand(["SET", key, JSON.stringify(settlement), "EX", 604800]);
    json(res, 200, settlement);
  } catch (error) {
    json(res, 503, { error: error instanceof Error ? error.message : "Contract reconciliation failed closed.", liveTradingEnabled: false });
  }
}

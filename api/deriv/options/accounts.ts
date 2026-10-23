import type { IncomingMessage, ServerResponse } from "node:http";
import { OAUTH_COOKIE, decryptSession, parseCookies } from "../../shared/oauth-session.js";

const API = "https://api.derivws.com/trading/v1/options/accounts";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    json(res, 405, { error: "Method not allowed." });
    return;
  }

  const cookies = parseCookies(typeof req.headers.cookie === "string" ? req.headers.cookie : null);
  const session = decryptSession(cookies[OAUTH_COOKIE], process.env.SESSION_SECRET ?? "");
  if (!session) {
    json(res, 401, { error: "Connect Deriv before requesting account information." });
    return;
  }

  try {
    const response = await fetch(API, {
      method: "GET",
      headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!response.ok) {
      json(res, response.status === 401 || response.status === 403 ? 401 : 502, {
        error: "Deriv account discovery failed. Reconnect and verify API permissions.",
      });
      return;
    }
    const payload = await response.json() as { data?: unknown; accounts?: unknown };
    const raw = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.accounts) ? payload.accounts : null;
    if (!raw) {
      json(res, 502, { error: "Deriv returned an unexpected account-list response." });
      return;
    }

    const accounts = raw.flatMap((item): Array<Record<string, string | number | boolean | null>> => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const accountId = value.account_id ?? value.accountId ?? value.loginid;
      if (typeof accountId !== "string" || !/^(CR|VRTC|CRW|VRW)\d+$/.test(accountId)) return [];
      const currency = typeof value.currency === "string" ? value.currency : null;
      const accountType = typeof value.account_type === "string" ? value.account_type
        : typeof value.accountType === "string" ? value.accountType : null;
      const status = typeof value.status === "string" ? value.status : null;
      const balance = typeof value.balance === "number" && Number.isFinite(value.balance) ? value.balance : null;
      return [{ accountId, currency, accountType, status, balance, isRealTradingAccount: /^CR\d+$/.test(accountId) }];
    });

    json(res, 200, { accounts });
  } catch {
    json(res, 502, { error: "Deriv account discovery is temporarily unavailable." });
  }
}

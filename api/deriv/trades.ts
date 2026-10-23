import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocket } from "ws";
import { OAUTH_COOKIE, decryptSession, parseCookies } from "../../shared/oauth-session.js";

type Reply = { req_id?: number; error?: { code?: string }; authorize?: Record<string, unknown>;
  portfolio?: { contracts?: Array<Record<string, unknown>> };
  profit_table?: { transactions?: Array<Record<string, unknown>> } };
type StoredOrder = { status?: string; contractId?: number; symbol?: string; stake?: number; currency?: string; submittedAt?: string; [key: string]: unknown };
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(body));
}
function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}
async function redisCommand<T>(command: (string | number)[]): Promise<T | null> {
  const config = redisConfig();
  if (!config) throw new Error("Durable risk storage is not configured.");
  const response = await fetch(config.url, { method: "POST", headers: { Authorization: "Bearer " + config.token, "Content-Type": "application/json" },
    body: JSON.stringify(command), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Durable risk storage is unavailable.");
  const result = await response.json() as { result?: T; error?: string };
  if (result.error) throw new Error("Durable risk storage rejected the request.");
  return result.result ?? null;
}
async function brokerSnapshot(token: string): Promise<{ account: Record<string, unknown>; contracts: Array<Record<string, unknown>>; transactions: Array<Record<string, unknown>> }> {
  const appId = process.env.DERIV_APP_ID?.trim() || process.env.VITE_DERIV_APP_ID?.trim();
  if (!appId || !/^\d+$/.test(appId)) throw new Error("Server-side DERIV_APP_ID is not configured.");
  const endpoint = process.env.DERIV_TRADING_WS_URL?.trim() || "wss://ws.derivws.com/websockets/v3?app_id=" + encodeURIComponent(appId);
  if (!endpoint.startsWith("wss://")) throw new Error("Deriv trading endpoint must use secure WebSocket.");
  const ws = new WebSocket(endpoint);
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Deriv WebSocket timed out.")), 8000);
      ws.once("open", () => { clearTimeout(timeout); resolve(); });
      ws.once("error", () => { clearTimeout(timeout); reject(new Error("Deriv WebSocket connection failed.")); });
    });
    let nextId = 1;
    const send = (payload: Record<string, unknown>) => new Promise<Reply>((resolve, reject) => {
      const id = nextId++;
      const timeout = setTimeout(() => { ws.off("message", onMessage); reject(new Error("Deriv response timed out.")); }, 10000);
      const onMessage = (data: WebSocket.RawData) => {
        let message: Reply;
        try { message = JSON.parse(data.toString()) as Reply; } catch { return; }
        if (message.req_id !== id) return;
        clearTimeout(timeout); ws.off("message", onMessage);
        if (message.error) reject(new Error("Deriv rejected a history request (" + (message.error.code || "API_ERROR") + ")."));
        else resolve(message);
      };
      ws.on("message", onMessage);
      ws.send(JSON.stringify({ ...payload, req_id: id }), error => {
        if (error) { clearTimeout(timeout); ws.off("message", onMessage); reject(new Error("Could not send request to Deriv.")); }
      });
    });
    const auth = await send({ authorize: token });
    if (!auth.authorize) throw new Error("Deriv authorization is not valid.");
    const portfolio = await send({ portfolio: 1 });
    const profits = await send({ profit_table: 1, description: 1, limit: 500, offset: 0, sort: "DESC" });
    if (!Array.isArray(portfolio.portfolio?.contracts) || !Array.isArray(profits.profit_table?.transactions)) {
      throw new Error("Broker contract history is incomplete; reconciliation cannot be confirmed.");
    }
    return { account: auth.authorize, contracts: portfolio.portfolio.contracts, transactions: profits.profit_table.transactions };
  } finally { try { ws.close(); } catch { /* best effort */ } }
}
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); sendJson(res, 405, { error: "Method not allowed." }); return; }
  const secret = process.env.SESSION_SECRET ?? "";
  const cookies = parseCookies(typeof req.headers.cookie === "string" ? req.headers.cookie : null);
  const session = decryptSession(cookies[OAUTH_COOKIE], secret);
  if (!session) { sendJson(res, 401, { error: "Connect Deriv before viewing broker-confirmed trade history." }); return; }
  try {
    const snapshot = await brokerSnapshot(session.accessToken);
    const accountId = String(snapshot.account.loginid ?? "");
    if (snapshot.account.is_virtual !== 1 || !/^VRTC\d+$/.test(accountId)) {
      sendJson(res, 403, { error: "Only a broker-verified Deriv virtual account can use this endpoint." }); return;
    }
    const prefix = "butcher:demo:" + accountId + ":contract:";
    const scan = await redisCommand<[string, string[]]>(["SCAN", "0", "MATCH", prefix + "*", "COUNT", "100"]);
    const keys = Array.isArray(scan?.[1]) ? scan[1] : [];
    const stored: StoredOrder[] = [];
    for (const key of keys) {
      const value = await redisCommand<string>(["GET", key]);
      if (value) { try { stored.push(JSON.parse(value) as StoredOrder); } catch { /* ignore malformed stale record */ } }
    }
    const openById = new Map(snapshot.contracts.map(item => [String(item.contract_id ?? ""), item]));
    const closedById = new Map(snapshot.transactions.map(item => [String(item.contract_id ?? ""), item]));
    const trades = stored.map(order => {
      const id = String(order.contractId ?? "");
      const open = openById.get(id);
      if (open) return { ...order, status: "open", brokerConfirmed: true, broker: {
        contractId: open.contract_id, profit: open.profit ?? null, payout: open.payout ?? null,
        currentSpot: open.current_spot ?? null, entrySpot: open.entry_spot ?? null, dateExpiry: open.date_expiry ?? null
      } };
      const closed = closedById.get(id);
      if (closed) return { ...order, status: "closed", brokerConfirmed: true, result: {
        contractId: closed.contract_id, profit: closed.profit ?? null, buyPrice: closed.buy_price ?? null,
        sellPrice: closed.sell_price ?? null, sellTime: closed.sell_time ?? null, status: closed.status ?? null
      } };
      return { ...order, status: "unreconciled", brokerConfirmed: false,
        note: "No matching open contract or closed broker transaction was returned. Do not retry the order automatically." };
    });
    sendJson(res, 200, { account: accountId, accountMode: "demo", trades,
      brokerHistoryCheckedAt: new Date().toISOString(), liveTradingEnabled: false });
  } catch (error) {
    sendJson(res, 503, { error: error instanceof Error ? error.message : "Broker history reconciliation failed.",
      brokerConfirmed: false, liveTradingEnabled: false });
  }
}

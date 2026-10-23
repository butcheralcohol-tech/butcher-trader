import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocket } from "ws";
import { OAUTH_COOKIE, decryptSession, parseCookies } from "../../shared/oauth-session.js";

type Reply = { req_id?: number; error?: { code?: string; message?: string }; authorize?: Record<string, unknown>; contracts_for?: { available?: Array<Record<string, unknown>> } };
function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(body));
}
async function requestContracts(token: string, symbol: string): Promise<{ account: Record<string, unknown>; contracts: Array<Record<string, unknown>> }> {
  const appId = process.env.DERIV_APP_ID?.trim() || process.env.VITE_DERIV_APP_ID?.trim();
  if (!appId || !/^\d+$/.test(appId)) throw new Error("Server-side DERIV_APP_ID is not configured.");
  const endpoint = process.env.DERIV_TRADING_WS_URL?.trim() || `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`;
  if (!endpoint.startsWith("wss://")) throw new Error("Deriv endpoint must use secure WebSocket.");
  const ws = new WebSocket(endpoint);
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Deriv WebSocket timed out.")), 8000);
      ws.once("open", () => { clearTimeout(timeout); resolve(); });
      ws.once("error", () => { clearTimeout(timeout); reject(new Error("Deriv WebSocket connection failed.")); });
    });
    let nextId = 1;
    const send = (payload: Record<string, unknown>) => new Promise<Reply>((resolve, reject) => {
      const req_id = nextId++;
      const timeout = setTimeout(() => { ws.off("message", onMessage); reject(new Error("Deriv response timed out.")); }, 10000);
      const onMessage = (data: WebSocket.RawData) => {
        let message: Reply;
        try { message = JSON.parse(data.toString()) as Reply; } catch { return; }
        if (message.req_id !== req_id) return;
        clearTimeout(timeout); ws.off("message", onMessage);
        if (message.error) reject(new Error("Deriv rejected contract discovery (" + (message.error.code || "API_ERROR") + ")."));
        else resolve(message);
      };
      ws.on("message", onMessage);
      ws.send(JSON.stringify({ ...payload, req_id }), error => {
        if (error) { clearTimeout(timeout); ws.off("message", onMessage); reject(new Error("Could not send request to Deriv.")); }
      });
    });
    const authReply = await send({ authorize: token });
    if (!authReply.authorize) throw new Error("Deriv authorization is not valid.");
    const result = await send({ contracts_for: symbol, currency: String(authReply.authorize.currency || "USD"), product_type: "basic" });
    const contracts = result.contracts_for?.available;
    if (!Array.isArray(contracts)) throw new Error("Deriv did not return available contracts for this market.");
    return { account: authReply.authorize, contracts };
  } finally { try { ws.close(); } catch { /* best effort */ } }
}
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); sendJson(res, 405, { error: "Method not allowed." }); return; }
  const session = decryptSession(parseCookies(typeof req.headers.cookie === "string" ? req.headers.cookie : null)[OAUTH_COOKIE], process.env.SESSION_SECRET ?? "");
  if (!session) { sendJson(res, 401, { error: "Connect Deriv before discovering available contracts." }); return; }
  const rawSymbol = new URL(req.url || "/", "https://local.invalid").searchParams.get("symbol") || "";
  const symbol = rawSymbol.trim();
  if (!/^[A-Z0-9_]{2,32}$/.test(symbol)) { sendJson(res, 400, { error: "A valid market symbol is required." }); return; }
  try {
    const result = await requestContracts(session.accessToken, symbol);
    const loginid = String(result.account.loginid || "");
    if (result.account.is_virtual !== 1 || !/^VRTC\d+$/.test(loginid)) {
      sendJson(res, 403, { error: "Contract discovery is restricted to a verified Deriv virtual account." }); return;
    }
    const contracts = result.contracts.map(contract => ({
      contractType: typeof contract.contract_type === "string" ? contract.contract_type : "",
      category: typeof contract.contract_category === "string" ? contract.contract_category : "",
      label: typeof contract.contract_display === "string" ? contract.contract_display : (typeof contract.contract_type === "string" ? contract.contract_type : ""),
      barriers: contract.barriers ?? null,
      sentiment: contract.sentiment ?? null,
      contractCategoryDisplay: contract.contract_category_display ?? null,
      expiryType: contract.expiry_type ?? null,
      minDuration: contract.min_contract_duration ?? null,
      maxDuration: contract.max_contract_duration ?? null,
      startType: contract.start_type ?? null,
      multiplierRange: contract.multiplier_range ?? null,
    })).filter(contract => contract.contractType);
    sendJson(res, 200, { mode: "demo", account: loginid, symbol, contracts });
  } catch (error) {
    sendJson(res, 503, { error: error instanceof Error ? error.message : "Contract discovery failed closed." });
  }
}

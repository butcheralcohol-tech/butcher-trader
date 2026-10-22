import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocket } from "ws";
import { OAUTH_COOKIE, decryptSession, parseCookies } from "../../shared/oauth-session.js";
import { evaluateDemoExecutionRisk, type DemoAccount } from "../../shared/demo-execution.js";

type DerivReply = { req_id?: number; error?: { code?: string; message?: string }; authorize?: Record<string, unknown>;
  proposal?: { id?: string; ask_price?: number; payout?: number; longcode?: string };
  buy?: { contract_id?: number; buy_price?: number; transaction_id?: number } };
const APP_ORIGIN = "https://butcherfx.vercel.app";
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(body));
};
function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}
async function redisCommand<T>(command: (string | number)[]): Promise<T | null> {
  const config = redisConfig();
  if (!config) throw new Error("Durable risk storage is not configured; orders are disabled.");
  const response = await fetch(config.url, { method: "POST", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Durable risk storage unavailable; orders are disabled.");
  const result = await response.json() as { result?: T; error?: string };
  if (result.error) throw new Error("Durable risk storage rejected the request.");
  return result.result ?? null;
}
async function acquireLock(key: string): Promise<boolean> {
  return (await redisCommand<string>(["SET", key, "locked", "NX", "EX", 20])) === "OK";
}
async function brokerRequest(token: string, payloads: Record<string, unknown>[]): Promise<DerivReply[]> {
  const appId = process.env.DERIV_APP_ID?.trim() || process.env.VITE_DERIV_APP_ID?.trim();
  if (!appId || !/^\d+$/.test(appId)) throw new Error("Server-side DERIV_APP_ID is not configured.");
  const endpoint = process.env.DERIV_TRADING_WS_URL?.trim() || `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`;
  if (!endpoint.startsWith("wss://")) throw new Error("Deriv trading endpoint must use secure WebSocket.");
  const ws = new WebSocket(endpoint);
  const replies: DerivReply[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Deriv WebSocket connection timed out.")), 8000);
      ws.once("open", () => { clearTimeout(timeout); resolve(); });
      ws.once("error", () => { clearTimeout(timeout); reject(new Error("Deriv WebSocket connection failed.")); });
    });
    let nextId = 1;
    const send = (payload: Record<string, unknown>) => new Promise<DerivReply>((resolve, reject) => {
      const req_id = nextId++;
      const timeout = setTimeout(() => { ws.off("message", onMessage); reject(new Error("Deriv response timed out; order status must be reconciled before retry.")); }, 10000);
      const onMessage = (data: WebSocket.RawData) => {
        let message: DerivReply;
        try { message = JSON.parse(data.toString()) as DerivReply; } catch { return; }
        if (message.req_id !== req_id) return;
        clearTimeout(timeout); ws.off("message", onMessage);
        if (message.error) reject(new Error(`Deriv rejected request (${message.error.code || "API_ERROR"}).`));
        else resolve(message);
      };
      ws.on("message", onMessage);
      ws.send(JSON.stringify({ ...payload, req_id }), (error) => {
        if (error) { clearTimeout(timeout); ws.off("message", onMessage); reject(new Error("Could not send request to Deriv.")); }
      });
    });
    const auth = await send({ authorize: token });
    if (!auth.authorize) throw new Error("Deriv did not authorize this session.");
    replies.push(auth);
    for (const payload of payloads) replies.push(await send(payload));
    return replies;
  } finally { try { ws.close(); } catch { /* best effort */ } }
}
function todayStartUnix(): number { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return Math.floor(d.getTime() / 1000); }
function numberField(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); json(res, 405, { error: "Method not allowed." }); return; }
  const secret = process.env.SESSION_SECRET ?? "";
  const cookies = parseCookies(typeof req.headers.cookie === "string" ? req.headers.cookie : null);
  const session = decryptSession(cookies[OAUTH_COOKIE], secret);
  if (!session) { json(res, 401, { error: "Connect Deriv again before placing a demo order." }); return; }
  const requestId = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : "";
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) { json(res, 400, { error: "A unique Idempotency-Key (16–100 safe characters) is required." }); return; }
  let raw = "";
  try {
    for await (const chunk of req) { raw += chunk.toString(); if (raw.length > 8192) { json(res, 413, { error: "Request body too large." }); return; } }
  } catch { json(res, 400, { error: "Unable to read request." }); return; }
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw || "{}") as Record<string, unknown>; } catch { json(res, 400, { error: "Invalid JSON." }); return; }
  const symbol = typeof body.symbol === "string" ? body.symbol : "";
  const contractType = body.contractType;
  const duration = body.duration;
  const durationUnit = body.durationUnit;
  const stake = numberField(body.stake);
  if (!/^[A-Z0-9_]{2,32}$/.test(symbol) || !["CALL", "PUT"].includes(String(contractType)) ||
      !Number.isInteger(duration) || Number(duration) < 1 || Number(duration) > 10 ||
      durationUnit !== "m" || stake === null || stake <= 0) {
    json(res, 400, { error: "Invalid order. Use a valid symbol, CALL/PUT, 1–10 minutes, and a positive stake." }); return;
  }
  let account: DemoAccount | null = null;
  try {
    const authReplies = await brokerRequest(session.accessToken, [{ balance: 1 }, { portfolio: 1 }, { profit_table: 1, description: 1, limit: 500, offset: 0, sort: "DESC" }]);
    const auth = authReplies[0].authorize;
    if (!auth) throw new Error("No broker authorization response.");
    account = { loginid: String(auth.loginid ?? ""), is_virtual: auth.is_virtual === 1 ? 1 : 0,
      currency: String(auth.currency ?? ""), balance: numberField(auth.balance) ?? 0 };
    if (account.is_virtual !== 1 || !/^VRTC\d+$/.test(account.loginid)) {
      json(res, 403, { error: "This endpoint only permits broker-verified Deriv virtual accounts." }); return;
    }
    const balanceReply = authReplies[1].balance as Record<string, unknown> | undefined;
    const brokerBalance = numberField(balanceReply?.balance);
    const currency = typeof balanceReply?.currency === "string" ? balanceReply.currency : account.currency;
    if (brokerBalance === null || currency !== account.currency) throw new Error("Could not verify the broker balance and currency.");
    account = { ...account, balance: brokerBalance };
    const portfolio = authReplies[2] as unknown as { portfolio?: { contracts?: Array<unknown> } };
    const openContracts = Array.isArray(portfolio.portfolio?.contracts) ? portfolio.portfolio.contracts.length : 0;
    const profits = authReplies[3] as unknown as { profit_table?: { transactions?: Array<Record<string, unknown>> } };
    const transactions = profits.profit_table?.transactions;
    if (!Array.isArray(transactions)) throw new Error("Broker profit history is unavailable; fail closed.");
    const today = todayStartUnix();
    const dailyNetPnl = transactions.reduce((sum, transaction) => {
      const sellTime = numberField(transaction.sell_time);
      const profit = numberField(transaction.profit);
      return sellTime !== null && sellTime >= today && profit !== null ? sum + profit : sum;
    }, 0);
    const risk = evaluateDemoExecutionRisk({ account, stake, dailyNetPnl, dailyLossLimitUsd: 20,
      dailyProfitTargetUsd: 40, riskPercent: 1, openContracts, maxOpenContracts: 1 });
    if (!risk.allowed) { json(res, 423, { error: "Risk checks blocked this order.", reasons: risk.reasons, maxStake: risk.maxStake, dailyNetPnl }); return; }
    const storagePrefix = `butcher:demo:${account.loginid}`;
    const previous = await redisCommand<string>(["GET", `${storagePrefix}:idempotency:${requestId}`]);
    if (previous) { json(res, 200, { ...JSON.parse(previous), replayed: true }); return; }
    const lock = await acquireLock(`${storagePrefix}:execution-lock`);
    if (!lock) { json(res, 423, { error: "Another order is being processed. Retry only after checking order history." }); return; }
    try {
      const proposal = await brokerRequest(session.accessToken, [{ proposal: 1, amount: stake, basis: "stake",
        contract_type: contractType, currency: account.currency, duration: Number(duration), duration_unit: "m", symbol }]);
      const proposalData = proposal[1]?.proposal;
      if (!proposalData?.id || numberField(proposalData.ask_price) === null) throw new Error("Broker proposal was incomplete; no buy request was sent.");
      const buy = await brokerRequest(session.accessToken, [{ buy: String(proposalData.id), price: stake }]);
      const receipt = buy[1]?.buy;
      if (!receipt?.contract_id || numberField(receipt.buy_price) === null) throw new Error("Broker buy receipt was not confirmed. Reconcile account history before retrying.");
      const result = { status: "open", mode: "demo", account: account.loginid, contractId: receipt.contract_id,
        transactionId: receipt.transaction_id ?? null, symbol, contractType, stake: receipt.buy_price, currency: account.currency,
        proposalPayout: proposalData.payout ?? null, dailyNetPnlAtEntry: dailyNetPnl, submittedAt: new Date().toISOString(),
        brokerConfirmed: true, liveTradingEnabled: false };
      await redisCommand(["SET", `${storagePrefix}:idempotency:${requestId}`, JSON.stringify(result), "EX", 86400]);
      await redisCommand(["SET", `${storagePrefix}:contract:${receipt.contract_id}`, JSON.stringify(result), "EX", 604800]);
      json(res, 201, result);
    } finally {
      await redisCommand(["DEL", `${storagePrefix}:execution-lock`]).catch(() => null);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Demo execution failed closed.";
    json(res, 503, { error: message, noRetryUntilReconciled: message.includes("timed out") || message.includes("status must be reconciled"), liveTradingEnabled: false });
  }
}

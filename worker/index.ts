/**
 * Always-on robot worker. Runs the strategy ensemble on live Deriv candles 24/7 and sends each new entry to
 * POST {WORKER_API_BASE}/api/deriv/trade, so EVERY server-side gate applies (risk, one-open-contract lock,
 * real-money gate, kill switches). The worker never talks to the broker's trading socket itself.
 *
 * Run: npm run worker      Health: GET :$PORT/health
 */
import "dotenv/config";
import http from "node:http";
import { WebSocket } from "ws";
import { parseHistory } from "../shared/candles.js";
import { classifyAccount } from "../shared/account-kind.js";
import { REAL_CONFIRM_PHRASE } from "../shared/real-gate.js";
import { initWorkerState, parseWorkerState, stepWorker, type WorkerSettings, type WorkerState } from "../shared/worker-core.js";
import type { Candle } from "../shared/types.js";

const env = process.env;
const log = (msg: string, extra?: unknown) => console.log(`${new Date().toISOString()} ${msg}`, extra ?? "");

function need(name: string): string {
  const v = env[name]?.trim();
  if (!v) throw new Error(`Missing required environment variable ${name}.`);
  return v;
}

const cfg = (() => {
  const apiBase = need("WORKER_API_BASE").replace(/\/+$/, "");
  if (!/^https:\/\//.test(apiBase) && !/^http:\/\/localhost(:\d+)?$/.test(apiBase)) throw new Error("WORKER_API_BASE must be https:// (or http://localhost).");
  const secret = need("WORKER_SECRET");
  if (secret.length < 32) throw new Error("WORKER_SECRET must be at least 32 characters.");
  const accountId = need("WORKER_ACCOUNT_ID").toUpperCase();
  const kind = classifyAccount(accountId);
  if (kind === "unsupported") throw new Error(`WORKER_ACCOUNT_ID ${accountId} is not a supported demo or real trading account.`);
  let realConfirmation: string | undefined;
  if (kind === "real") {
    if (env.WORKER_REAL_CONFIRMATION !== REAL_CONFIRM_PHRASE) throw new Error(`Real account selected: set WORKER_REAL_CONFIRMATION to the exact phrase "${REAL_CONFIRM_PHRASE}" to allow the worker to attempt real orders (the server gates still apply).`);
    realConfirmation = REAL_CONFIRM_PHRASE;
  }
  const settings: WorkerSettings = {
    symbol: env.WORKER_SYMBOL?.trim() || "R_100",
    granularity: Number(env.WORKER_GRANULARITY || 60),
    strategyIds: (env.WORKER_STRATEGIES || "ema-cross-rsi,rsi-reversion,bollinger-reversion").split(",").map((s) => s.trim()).filter(Boolean),
    consensusPercent: Number(env.WORKER_CONSENSUS_PERCENT || 60),
    balance: Number(env.WORKER_PAPER_BALANCE || 1000),
  };
  const stake = Number(env.WORKER_STAKE || 1);
  if (!Number.isFinite(stake) || stake <= 0) throw new Error("WORKER_STAKE must be a positive number.");
  const redisUrl = need("UPSTASH_REDIS_REST_URL"), redisToken = need("UPSTASH_REDIS_REST_TOKEN"); // state must survive restarts, or fail closed
  return {
    apiBase, secret, accountId, kind, realConfirmation, settings, stake, redisUrl, redisToken,
    pollMs: Math.max(1000, Number(env.WORKER_POLL_SECONDS || 15) * 1000),
    enabled: env.WORKER_ENABLED === "true", // false = signals are computed and logged, but no orders are sent
    stateKey: `butcher:worker:${accountId}:${settings.symbol}:${settings.granularity}`,
    port: Number(env.PORT || 8080),
  };
})();

async function redis(command: Array<string | number>): Promise<unknown> {
  const r = await fetch(cfg.redisUrl, { method: "POST", headers: { Authorization: `Bearer ${cfg.redisToken}`, "Content-Type": "application/json" }, body: JSON.stringify(command) });
  const data = (await r.json().catch(() => ({}))) as { result?: unknown; error?: string };
  if (!r.ok || data.error) throw new Error(`Redis error: ${data.error ?? r.status}`);
  return data.result;
}

function fetchCandles(symbol: string, granularity: number, count = 500, timeoutMs = 20000): Promise<Candle[]> {
  const urls = ["wss://api.derivws.com/trading/v1/options/ws/public", `wss://ws.derivws.com/websockets/v3?app_id=${env.DERIV_APP_ID || "1089"}`];
  const attempt = (url: string) => new Promise<Candle[]>((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.terminate(); reject(new Error(`Timed out: ${url}`)); }, timeoutMs);
    const finish = (fn: () => void) => { clearTimeout(timer); try { ws.close(); } catch { /* noop */ } fn(); };
    ws.on("open", () => ws.send(JSON.stringify({ ticks_history: symbol, adjust_start_time: 1, count, end: "latest", style: "candles", granularity })));
    ws.on("error", (e) => finish(() => reject(e)));
    ws.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.error) return finish(() => reject(new Error(String((msg.error as { message?: string }).message ?? "Deriv error"))));
      const candles = parseHistory(msg);
      if (candles.length) finish(() => resolve(candles));
    });
  });
  return (async () => {
    let last: unknown;
    for (const url of urls) { try { return await attempt(url); } catch (e) { last = e; } }
    throw last instanceof Error ? last : new Error("Could not load candles.");
  })();
}

const status = { startedAt: Date.now(), enabled: cfg.enabled, account: cfg.accountId, mode: cfg.kind, lastPollAt: 0, lastCandleTime: 0, ordersSent: 0, ordersRejected: 0, lastMessage: "starting", lastError: "" };

async function sendOrder(order: { contractType: string; idempotencyKey: string }): Promise<void> {
  if (!cfg.enabled) { log(`SIGNAL (not sent, WORKER_ENABLED!=true): ${order.contractType}`); status.lastMessage = `signal ${order.contractType} (dry run)`; return; }
  const r = await fetch(`${cfg.apiBase}/api/deriv/trade`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": order.idempotencyKey, Authorization: `Bearer ${cfg.secret}` },
    body: JSON.stringify({ accountId: cfg.accountId, ...(cfg.realConfirmation ? { realMoneyConfirmation: cfg.realConfirmation } : {}), symbol: cfg.settings.symbol, contractType: order.contractType, duration: 1, durationUnit: "m", stake: cfg.stake }),
  });
  const data = (await r.json().catch(() => ({}))) as { error?: string; reasons?: string[]; contractId?: number; mode?: string; noRetryUntilReconciled?: boolean };
  if (r.ok) { status.ordersSent++; status.lastMessage = `${data.mode} order #${data.contractId}`; log(`ORDER OK ${data.mode} #${data.contractId}`); return; }
  status.ordersRejected++;
  const why = [data.error, ...(data.reasons ?? [])].filter(Boolean).join(" ");
  status.lastMessage = `order rejected (${r.status}): ${why}`;
  log(`ORDER REJECTED ${r.status}: ${why}${data.noRetryUntilReconciled ? " [CHECK BROKER HISTORY BEFORE RETRYING]" : ""}`);
}

async function loadState(candles: Candle[]): Promise<WorkerState> {
  const raw = (await redis(["GET", cfg.stateKey])) as string | null;
  if (raw) { try { const s = parseWorkerState(JSON.parse(raw)); if (s) { log("Resumed saved worker state."); return s; } } catch { /* fall through */ } log("Saved state unreadable; starting a fresh session (history is not replayed)."); }
  return initWorkerState(cfg.settings, candles);
}

let busy = false;
async function tick(stateRef: { s: WorkerState | null }): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const candles = await fetchCandles(cfg.settings.symbol, cfg.settings.granularity);
    status.lastPollAt = Date.now();
    stateRef.s ??= await loadState(candles);
    const { state, orders } = stepWorker(stateRef.s, candles);
    if (state !== stateRef.s) {
      // Persist BEFORE sending: a crash can drop an order but can never send one twice.
      await redis(["SET", cfg.stateKey, JSON.stringify(state)]);
      stateRef.s = state;
      status.lastCandleTime = state.lastCandleTime;
    }
    for (const order of orders) await sendOrder(order);
    status.lastError = "";
  } catch (e) {
    status.lastError = e instanceof Error ? e.message : String(e);
    log(`tick failed: ${status.lastError}`);
  } finally { busy = false; }
}

const stateRef: { s: WorkerState | null } = { s: null };
http.createServer((req, res) => {
  if (req.url?.startsWith("/health")) {
    const stale = status.lastPollAt > 0 && Date.now() - status.lastPollAt > cfg.pollMs * 6;
    res.writeHead(stale ? 503 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: !stale, ...status }));
  } else { res.writeHead(404); res.end(); }
}).listen(cfg.port, () => log(`Worker up. account=${cfg.accountId} (${cfg.kind}) symbol=${cfg.settings.symbol} orders=${cfg.enabled ? "ENABLED" : "dry-run"} health=:${cfg.port}/health`));

void tick(stateRef);
setInterval(() => void tick(stateRef), cfg.pollMs);
process.on("unhandledRejection", (e) => log("unhandledRejection", e));

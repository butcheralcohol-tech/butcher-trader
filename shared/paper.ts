import { clampParams, getStrategy, type Params } from "./strategy.js";
import { createState, stepCandle, type SimConfig, type SimState } from "./sim.js";
import type { Candle } from "./types.js";

/** Demo-only paper trading session. Nothing here talks to a broker. */
export type PaperMeta = { symbol: string; granularity: number; strategyId: string; params: Params; cfg: SimConfig; startedAt: number };
export type PaperSession = { version: 1; meta: PaperMeta; state: SimState };

export const MAX_REPLAY = 3;
const MAX_EVENTS = 500, MAX_TRADES = 300;

export const newSession = (meta: PaperMeta, balance: number): PaperSession => {
  const state = createState(balance, true);
  return { version: 1, meta, state };
};

/** Feed CLOSED candles (never the still-forming one). Each candle is processed once, guarded by lastCandleTime, so reconnects cannot double-fill. */
export function advancePaper(session: PaperSession, closed: Candle[]): PaperSession {
  if (!closed.length) return session;
  const state = structuredClone(session.state);
  const { meta } = session;
  const last = closed[closed.length - 1];
  if (state.lastCandleTime === 0) {
    state.lastCandleTime = last.time;
    state.dayKey = new Date(last.time * 1000).toISOString().slice(0, 10);
    state.events.push({ time: last.time, type: "INFO", message: `Paper session started on ${meta.symbol}. Waiting for the next closed candle.` });
    return { ...session, state };
  }
  const fresh = closed.filter(c => c.time > state.lastCandleTime);
  if (!fresh.length) return session;
  const strategy = getStrategy(meta.strategyId);
  const signalAt = strategy.create(closed, clampParams(strategy, meta.params));
  const replayOnly = fresh.length > MAX_REPLAY;
  if (replayOnly) {
    state.pending = null;
    state.events.push({ time: last.time, type: "INFO", message: `Feed gap: ${fresh.length} candles missed. Open positions were still checked against them; no new entries were taken from stale data.` });
  }
  const offset = closed.length - fresh.length;
  fresh.forEach((c, k) => stepCandle(state, c, replayOnly ? null : () => signalAt(offset + k), meta.cfg));
  if (state.events.length > MAX_EVENTS) state.events = state.events.slice(-MAX_EVENTS);
  if (state.trades.length > MAX_TRADES) state.trades = state.trades.slice(-MAX_TRADES);
  return { ...session, state };
}

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
export function parseSession(raw: unknown): PaperSession | null {
  try {
    const s = raw as PaperSession;
    if (!s || s.version !== 1 || !s.meta || !s.state) return null;
    const { meta, state } = s;
    if (typeof meta.symbol !== "string" || !num(meta.granularity) || typeof meta.strategyId !== "string" || !meta.cfg || !meta.params) return null;
    if (![state.startBalance, state.balance, state.dayPnl, state.lastCandleTime, state.nextId].every(num)) return null;
    if (!Array.isArray(state.trades) || !Array.isArray(state.events)) return null;
    return s;
  } catch { return null; }
}

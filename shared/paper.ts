import { clampParams, defaultParams, getStrategy, strategies, type Params } from "./strategy.js";
import { createState, stepCandle, type SimConfig, type SimState } from "./sim.js";
import type { Candle, Signal } from "./types.js";

/** Demo-only paper trading session. Nothing here talks to a broker account. */
export type PaperMeta = {
  symbol: string;
  granularity: number;
  strategyId: string;
  params: Params;
  /** Optional ensemble settings. Missing values preserve older saved sessions. */
  strategyIds?: string[];
  strategyParams?: Record<string, Params>;
  consensusPercent?: number;
  cfg: SimConfig;
  startedAt: number;
};
export type PaperSession = { version: 1; meta: PaperMeta; state: SimState };

export const MAX_REPLAY = 3;
const MAX_EVENTS = 500, MAX_TRADES = 300;

export const newSession = (meta: PaperMeta, balance: number): PaperSession => {
  const state = createState(balance, true);
  const ids = selectedIds(meta);
  state.events.push({
    time: Math.floor(meta.startedAt / 1000),
    type: "INFO",
    message: ids.length > 1
      ? `Multi-strategy paper bot armed: ${ids.map(id => getStrategy(id).name).join(", ")}. ${consensus(meta)}% directional consensus required. Demo simulation only; no broker orders.`
      : `Paper bot armed with ${getStrategy(ids[0]).name}. Demo simulation only; no broker orders.`,
  });
  return { version: 1, meta, state };
};

function selectedIds(meta: PaperMeta): string[] {
  const raw = Array.isArray(meta.strategyIds) ? meta.strategyIds : [meta.strategyId];
  const ids = [...new Set(raw.filter(id => strategies.some(s => s.id === id)))];
  return ids.length ? ids : [strategies[0].id];
}

function consensus(meta: PaperMeta): number {
  const value = Number(meta.consensusPercent ?? 60);
  return Number.isFinite(value) ? Math.min(100, Math.max(50, value)) : 60;
}

/** Signals vote only on closed candles. No trade unless one direction reaches the configured share of all enabled strategies. */
function ensembleSignal(meta: PaperMeta, candles: Candle[], index: number): Signal | null {
  const ids = selectedIds(meta);
  const votes = ids.flatMap(id => {
    const strategy = getStrategy(id);
    const params = meta.strategyParams?.[id] ?? (id === meta.strategyId ? meta.params : defaultParams(strategy));
    const signal = strategy.create(candles, clampParams(strategy, params))(index);
    return signal ? [{ id, name: strategy.name, signal }] : [];
  });
  if (!votes.length) return null;
  const longs = votes.filter(v => v.signal.side === "LONG");
  const shorts = votes.filter(v => v.signal.side === "SHORT");
  const threshold = Math.ceil(ids.length * consensus(meta) / 100);
  const winners = longs.length >= threshold ? longs : shorts.length >= threshold ? shorts : [];
  if (!winners.length) return null;
  const side = winners[0].signal.side;
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    side,
    stop: average(winners.map(v => v.signal.stop)),
    target: average(winners.map(v => v.signal.target)),
    reason: `Ensemble ${winners.length}/${ids.length} vote(s) for ${side} (required ${threshold}/${ids.length}): ${winners.map(v => `${v.name} — ${v.signal.reason}`).join("; ")}`,
  };
}

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
  const replayOnly = fresh.length > MAX_REPLAY;
  if (replayOnly) {
    state.pending = null;
    state.events.push({ time: last.time, type: "INFO", message: `Feed gap: ${fresh.length} candles missed. Open positions were still checked against them; no new entries were taken from stale data.` });
  }
  const offset = closed.length - fresh.length;
  // Compute each selected strategy's indicators once for this candle batch.
  const ids = selectedIds(meta);
  const evaluators = ids.map(id => {
    const strategy = getStrategy(id);
    const params = meta.strategyParams?.[id] ?? (id === meta.strategyId ? meta.params : defaultParams(strategy));
    return { strategy, evaluate: strategy.create(closed, clampParams(strategy, params)) };
  });
  fresh.forEach((c, k) => {
    const i = offset + k;
    stepCandle(state, c, replayOnly ? null : () => {
      // Keep the ensemble's vote aggregation deterministic; the same closed candle cannot be processed twice.
      const votes = evaluators.flatMap(({ strategy, evaluate }) => {
        const signal = evaluate(i);
        return signal ? [{ name: strategy.name, signal }] : [];
      });
      if (!votes.length) return null;
      const longs = votes.filter(v => v.signal.side === "LONG");
      const shorts = votes.filter(v => v.signal.side === "SHORT");
      const threshold = Math.ceil(ids.length * consensus(meta) / 100);
      const winners = longs.length >= threshold ? longs : shorts.length >= threshold ? shorts : [];
      if (!winners.length) return null;
      const side = winners[0].signal.side;
      const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
      return {
        side,
        stop: average(winners.map(v => v.signal.stop)),
        target: average(winners.map(v => v.signal.target)),
        reason: `Ensemble ${winners.length}/${ids.length} vote(s) for ${side} (required ${threshold}/${ids.length}): ${winners.map(v => `${v.name} — ${v.signal.reason}`).join("; ")}`,
      };
    }, meta.cfg);
  });
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
    if (meta.strategyIds !== undefined && (!Array.isArray(meta.strategyIds) || meta.strategyIds.length > strategies.length || !meta.strategyIds.every(id => typeof id === "string" && strategies.some(st => st.id === id)))) return null;
    if (meta.consensusPercent !== undefined && (!num(meta.consensusPercent) || meta.consensusPercent < 50 || meta.consensusPercent > 100)) return null;
    if (![state.startBalance, state.balance, state.dayPnl, state.lastCandleTime, state.nextId].every(num)) return null;
    if (!Array.isArray(state.trades) || !Array.isArray(state.events)) return null;
    return s;
  } catch { return null; }
}

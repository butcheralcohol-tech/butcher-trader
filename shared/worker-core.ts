import { advancePaper, newSession, parseSession, type PaperMeta, type PaperSession } from "./paper.js";
import { DEFAULT_SIM } from "./sim.js";
import { TRADING_POLICY } from "./trading-config.js";
import { defaultParams, getStrategy } from "./strategy.js";
import { newRobotOrders, type RobotOrder } from "./robot-signals.js";
import type { Candle } from "./types.js";

/** Persisted worker state. `handledUpTo` is advanced BEFORE orders are sent, so a crash can lose an order but never double-send one. */
export type WorkerState = { version: 1; session: PaperSession; handledUpTo: number; lastCandleTime: number };

export type WorkerSettings = { symbol: string; granularity: number; strategyIds: string[]; consensusPercent: number; balance: number };

export function buildMeta(s: WorkerSettings, now = Date.now()): PaperMeta {
  const ids = s.strategyIds.filter((id) => getStrategy(id).id === id);
  if (!ids.length) throw new Error("No valid strategy ids configured.");
  if (!Number.isFinite(s.consensusPercent) || s.consensusPercent < 50 || s.consensusPercent > 100) throw new Error("consensusPercent must be between 50 and 100.");
  if (!Number.isFinite(s.balance) || s.balance < TRADING_POLICY.minimumStartingBalanceUsd) throw new Error("Balance is below the minimum.");
  const first = getStrategy(ids[0]);
  return {
    symbol: s.symbol,
    granularity: s.granularity,
    strategyId: first.id,
    params: defaultParams(first),
    strategyIds: ids,
    strategyParams: Object.fromEntries(ids.map((id) => [id, defaultParams(getStrategy(id))])),
    consensusPercent: s.consensusPercent,
    strategyWeights: Object.fromEntries(ids.map((id) => [id, 1])),
    cfg: {
      ...DEFAULT_SIM,
      riskPercent: TRADING_POLICY.riskPercent,
      dailyLossLimitPercent: TRADING_POLICY.dailyLossLimitPercent,
      dailyLossLimitAmount: TRADING_POLICY.dailyLossLimitsUsd.SYNTHETIC,
      sessionLossLimitAmount: TRADING_POLICY.sessionLossLimitUsd,
      dailyProfitTargetAmount: TRADING_POLICY.dailyProfitTargetUsd,
      tradeProfitTargetAmount: 10,
      sessionProfitTargetAmount: TRADING_POLICY.dailyProfitTargetUsd,
    },
    startedAt: now,
  };
}

/** The last candle is still forming; only earlier ones count as closed. */
export const closedCandles = (candles: Candle[]): Candle[] => candles.slice(0, -1);

/** Start a fresh session. History already in the candle set never produces orders: handledUpTo is set past it. */
export function initWorkerState(s: WorkerSettings, candles: Candle[], now = Date.now()): WorkerState {
  const closed = closedCandles(candles);
  const session = advancePaper(newSession(buildMeta(s, now), s.balance), closed);
  // Anchor to candle time, not event time: newSession stamps its first event with the wall clock, which can sit ahead of the next candle.
  const anchor = closed.at(-1)?.time ?? 0;
  return { version: 1, session, handledUpTo: anchor, lastCandleTime: anchor };
}

/** Advance on new closed candles. Returns the next state (persist it first) and the orders to send. */
export function stepWorker(state: WorkerState, candles: Candle[]): { state: WorkerState; orders: RobotOrder[] } {
  const closed = closedCandles(candles);
  const newest = closed.at(-1)?.time ?? 0;
  if (!closed.length || newest <= state.lastCandleTime) return { state, orders: [] };
  const session = advancePaper(state.session, closed);
  const orders = newRobotOrders(session.state.events, state.handledUpTo, session.meta.startedAt, session.meta.symbol);
  const handledUpTo = orders.length ? Math.max(...orders.map((o) => o.time)) : state.handledUpTo;
  return { state: { ...state, session, handledUpTo, lastCandleTime: newest }, orders };
}

export function parseWorkerState(raw: unknown): WorkerState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const session = parseSession(r.session);
  if (r.version !== 1 || !session || typeof r.handledUpTo !== "number" || typeof r.lastCandleTime !== "number") return null;
  return { version: 1, session, handledUpTo: r.handledUpTo, lastCandleTime: r.lastCandleTime };
}



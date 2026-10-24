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
  /** Relative vote strength per strategy; omitted entries default to 1. */
  strategyWeights?: Record<string, number>;
  cfg: SimConfig;
  startedAt: number;
};
export type PaperSession = { version: 1; meta: PaperMeta; state: SimState };

export const MAX_REPLAY = 3;

/** Adjust the virtual cash balance only while flat; offset startBalance equally so this deposit/withdrawal does not masquerade as trading P&L. */
export function adjustPaperBalance(session: PaperSession, newBalance: number): PaperSession | null {
  if (
    !Number.isFinite(newBalance) ||
    newBalance < 2 ||
    newBalance > 1_000_000_000 ||
    session.state.position ||
    session.state.pending
  ) {
    return null;
  }
  const state = structuredClone(session.state);
  const delta = newBalance - state.balance;
  if (Math.abs(delta) < 0.000001) return session;
  state.balance = newBalance;
  state.startBalance += delta;
  state.events.push({
    time: Math.max(state.lastCandleTime, Math.floor(Date.now() / 1000)),
    type: "INFO",
    message: `Virtual balance adjusted by ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}; balance now ${newBalance.toFixed(2)}. Trading P&L baseline adjusted equally.`,
  });
  if (state.events.length > MAX_EVENTS) state.events = state.events.slice(-MAX_EVENTS);
  return { ...session, state };
}

/** Queue a user-directed paper order at a recent price. It remains virtual and is risk-checked again on fill. */
export function queueManualPaperSignal(
  session: PaperSession,
  side: "LONG" | "SHORT",
  referencePrice: number,
  stopPercent: number,
  rewardRisk: number,
): PaperSession | null {
  if (
    !Number.isFinite(referencePrice) ||
    referencePrice <= 0 ||
    !Number.isFinite(stopPercent) ||
    stopPercent < 0.1 ||
    stopPercent > 5 ||
    !Number.isFinite(rewardRisk) ||
    rewardRisk < 1 ||
    rewardRisk > 5 ||
    session.state.position ||
    session.state.pending ||
    session.state.lastCandleTime <= 0
  ) {
    return null;
  }
  const state = structuredClone(session.state);
  const distance = (referencePrice * stopPercent) / 100;
  const stop = side === "LONG" ? referencePrice - distance : referencePrice + distance;
  const target =
    side === "LONG" ? referencePrice + distance * rewardRisk : referencePrice - distance * rewardRisk;
  state.pending = {
    side,
    stop,
    target,
    signalTime: state.lastCandleTime,
    reason: `Manual paper ${side}; stop ${stopPercent}% from reference, target ${rewardRisk}:1 reward/risk.`,
  };
  state.events.push({
    time: state.lastCandleTime,
    type: "SIGNAL",
    message: `Manual PAPER ${side} queued near ${referencePrice.toFixed(referencePrice >= 100 ? 2 : 4)}; fill is pending next candle open and must pass risk gate.`,
  });
  return { ...session, state };
}

const MAX_EVENTS = 500;
const MAX_TRADES = 300;

export const newSession = (meta: PaperMeta, balance: number): PaperSession => {
  const state = createState(balance, true);
  const ids = selectedIds(meta);
  state.events.push({
    time: Math.floor(meta.startedAt / 1000),
    type: "INFO",
    message:
      ids.length > 1
        ? `Multi-strategy paper bot armed: ${ids.map((id) => getStrategy(id).name).join(", ")}. ${consensus(meta)}% directional consensus required. Demo simulation only; no broker orders.`
        : `Paper bot armed with ${getStrategy(ids[0]).name}. Demo simulation only; no broker orders.`,
  });
  return { version: 1, meta, state };
};

function selectedIds(meta: PaperMeta): string[] {
  const raw = Array.isArray(meta.strategyIds) ? meta.strategyIds : [meta.strategyId];
  const ids = [...new Set(raw.filter((id) => strategies.some((s) => s.id === id)))];
  return ids.length ? ids : [strategies[0].id];
}

function consensus(meta: PaperMeta): number {
  const value = Number(meta.consensusPercent ?? 60);
  return Number.isFinite(value) ? Math.min(100, Math.max(50, value)) : 60;
}

export function combineStrategySignals(
  votes: Array<{ name: string; signal: Signal; weight?: number }>,
  strategyCount: number,
  consensusPercent = 60,
  configuredWeights: number[] = [],
): Signal | null {
  if (!Number.isInteger(strategyCount) || strategyCount < 1 || !Number.isFinite(consensusPercent)) {
    return null;
  }
  const safeWeight = (value: number | undefined) =>
    Number.isFinite(value) && value! >= 0.1 && value! <= 5 ? value! : 1;
  const totalWeight =
    configuredWeights.length === strategyCount
      ? configuredWeights.reduce((sum, value) => sum + safeWeight(value), 0)
      : strategyCount;
  const threshold = (totalWeight * Math.min(100, Math.max(50, consensusPercent))) / 100;
  const weightOf = (vote: { weight?: number }) => safeWeight(vote.weight);
  const longs = votes.filter((v) => v.signal.side === "LONG");
  const shorts = votes.filter((v) => v.signal.side === "SHORT");
  const longWeight = longs.reduce((sum, v) => sum + weightOf(v), 0);
  const shortWeight = shorts.reduce((sum, v) => sum + weightOf(v), 0);
  const winners = longWeight >= threshold ? longs : shortWeight >= threshold ? shorts : [];
  if (!winners.length) return null;
  const side = winners[0].signal.side;
  const weightedAverage = (pick: (signal: Signal) => number) => {
    const weight = winners.reduce((sum, v) => sum + weightOf(v), 0);
    return winners.reduce((sum, v) => sum + pick(v.signal) * weightOf(v), 0) / weight;
  };
  const winningWeight = side === "LONG" ? longWeight : shortWeight;
  return {
    side,
    stop: weightedAverage((signal) => signal.stop),
    target: weightedAverage((signal) => signal.target),
    reason: `Weighted ensemble ${winningWeight.toFixed(2)}/${totalWeight.toFixed(2)} weight for ${side} (required ${threshold.toFixed(2)}): ${winners.map((v) => `${v.name} [w=${weightOf(v)}] — ${v.signal.reason}`).join("; ")}`,
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
    state.events.push({
      time: last.time,
      type: "INFO",
      message: `Paper session started on ${meta.symbol}. Waiting for the next closed candle.`,
    });
    return { ...session, state };
  }
  const fresh = closed.filter((c) => c.time > state.lastCandleTime);
  if (!fresh.length) return session;
  const replayOnly = fresh.length > MAX_REPLAY;
  if (replayOnly) {
    state.pending = null;
    state.events.push({
      time: last.time,
      type: "INFO",
      message: `Feed gap: ${fresh.length} candles missed. Open positions were still checked against them; no new entries were taken from stale data.`,
    });
  }
  const offset = closed.length - fresh.length;
  // Compute each selected strategy's indicators once for this candle batch.
  const ids = selectedIds(meta);
  const evaluators = ids.map((id) => {
    const strategy = getStrategy(id);
    const params = meta.strategyParams?.[id] ?? (id === meta.strategyId ? meta.params : defaultParams(strategy));
    const configuredWeight = meta.strategyWeights?.[id];
    const weight =
      Number.isFinite(configuredWeight) && configuredWeight! >= 0.1 && configuredWeight! <= 5
        ? configuredWeight!
        : 1;
    return { strategy, weight, evaluate: strategy.create(closed, clampParams(strategy, params)) };
  });
  fresh.forEach((c, k) => {
    const i = offset + k;
    stepCandle(
      state,
      c,
      replayOnly
        ? null
        : () => {
            // Keep the ensemble's vote aggregation deterministic; the same closed candle cannot be processed twice.
            const votes = evaluators.flatMap(({ strategy, weight, evaluate }) => {
              const signal = evaluate(i);
              return signal ? [{ name: strategy.name, signal, weight }] : [];
            });
            return combineStrategySignals(
              votes,
              ids.length,
              consensus(meta),
              evaluators.map((item) => item.weight),
            );
          },
      meta.cfg,
    );
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
    if (
      typeof meta.symbol !== "string" ||
      !num(meta.granularity) ||
      typeof meta.strategyId !== "string" ||
      !meta.cfg ||
      !meta.params
    ) {
      return null;
    }
    if (
      meta.strategyIds !== undefined &&
      (!Array.isArray(meta.strategyIds) ||
        meta.strategyIds.length > strategies.length ||
        !meta.strategyIds.every(
          (id) => typeof id === "string" && strategies.some((st) => st.id === id),
        ))
    ) {
      return null;
    }
    if (
      meta.consensusPercent !== undefined &&
      (!num(meta.consensusPercent) || meta.consensusPercent < 50 || meta.consensusPercent > 100)
    ) {
      return null;
    }
    if (
      ![state.startBalance, state.balance, state.dayPnl, state.lastCandleTime, state.nextId].every(num)
    ) {
      return null;
    }
    if (!Array.isArray(state.trades) || !Array.isArray(state.events)) return null;
    return s;
  } catch {
    return null;
  }
}

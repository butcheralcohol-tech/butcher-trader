import {
  createState,
  finalize,
  stepCandle,
  DEFAULT_SIM,
  type SimConfig,
  type Trade,
} from "./sim.js";
import { clampParams, type Params, type Strategy } from "./strategy.js";
import type { Candle } from "./types.js";

export type BacktestConfig = SimConfig & { initialBalance: number };
export const DEFAULT_BACKTEST: BacktestConfig = { ...DEFAULT_SIM, initialBalance: 1000 };

export type Metrics = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  returnPct: number;
  profitFactor: number | null;
  expectancyR: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdownPct: number;
  maxConsecLosses: number;
  feesPaid: number;
  finalBalance: number;
};

export type BacktestResult = {
  trades: Trade[];
  equity: { time: number; balance: number }[];
  metrics: Metrics;
  blockedSignals: number;
  skippedSignals: number;
  candles: number;
  from: number;
  to: number;
};

export function computeMetrics(trades: Trade[], initial: number, feesPaid: number): Metrics {
  let balance = initial;
  let peak = initial;
  let maxDd = 0;
  let streak = 0;
  let maxStreak = 0;
  let gross = 0;
  let lossSum = 0;
  let winSum = 0;
  let wins = 0;
  let losses = 0;
  let rSum = 0;

  for (const t of trades) {
    balance += t.pnl;
    rSum += t.r;
    if (t.pnl > 0) {
      wins++;
      winSum += t.pnl;
      streak = 0;
    } else {
      losses++;
      lossSum += -t.pnl;
      streak++;
      maxStreak = Math.max(maxStreak, streak);
    }
    gross += t.pnl;
    peak = Math.max(peak, balance);
    maxDd = Math.max(maxDd, peak > 0 ? ((peak - balance) / peak) * 100 : 0);
  }

  const n = trades.length;
  return {
    trades: n,
    wins,
    losses,
    winRate: n ? (wins / n) * 100 : 0,
    netPnl: gross,
    returnPct: (gross / initial) * 100,
    profitFactor: lossSum > 0 ? winSum / lossSum : null,
    expectancyR: n ? rSum / n : 0,
    avgWin: wins ? winSum / wins : 0,
    avgLoss: losses ? -lossSum / losses : 0,
    maxDrawdownPct: maxDd,
    maxConsecLosses: maxStreak,
    feesPaid,
    finalBalance: balance,
  };
}

/** Runs the strategy over candles[from, to). Indicators are causal, so earlier history is used for warm-up without look-ahead. */
export function runBacktest(
  candles: Candle[],
  strategy: Strategy,
  rawParams: Params,
  cfg: BacktestConfig,
  from = 0,
  to = candles.length,
): BacktestResult {
  const params = clampParams(strategy, rawParams);
  const state = createState(cfg.initialBalance, false);
  const signalAt = strategy.create(candles, params);
  const end = Math.min(to, candles.length);
  const equity = [{ time: candles[from]?.time ?? 0, balance: cfg.initialBalance }];

  for (let i = Math.max(0, from); i < end; i++) {
    const before = state.trades.length;
    stepCandle(state, candles[i], () => signalAt(i), cfg);
    if (state.trades.length > before) {
      equity.push({ time: candles[i].time, balance: state.balance });
    }
  }

  if (end > from) {
    const before = state.trades.length;
    finalize(state, candles[end - 1], cfg);
    if (state.trades.length > before) {
      equity.push({ time: candles[end - 1].time, balance: state.balance });
    }
  }

  return {
    trades: state.trades,
    equity,
    metrics: computeMetrics(state.trades, cfg.initialBalance, state.feesPaid),
    blockedSignals: state.blockedSignals,
    skippedSignals: state.skippedSignals,
    candles: Math.max(0, end - from),
    from,
    to: end,
  };
}

export type SplitResult = {
  inSample: BacktestResult;
  outOfSample: BacktestResult;
  splitIndex: number;
  verdict: string;
};

export function verdictFor(inSample: Metrics, oos: Metrics): string {
  if (oos.trades < 10) {
    return "Too few out-of-sample trades to judge. Treat this as no evidence either way.";
  }
  if (inSample.netPnl > 0 && oos.netPnl <= 0) {
    return "Profitable in-sample but not out-of-sample: a classic sign of overfitting. Do not trust this result.";
  }
  if (oos.netPnl > 0 && oos.expectancyR > 0) {
    return "Positive out-of-sample, but it is a single historical window. Forward-test on demo before trusting it.";
  }
  return "Not profitable out-of-sample.";
}

export function evaluateSplit(
  candles: Candle[],
  strategy: Strategy,
  params: Params,
  cfg: BacktestConfig,
  oosFraction = 0.3,
): SplitResult {
  const splitIndex = Math.floor(
    candles.length * (1 - Math.min(0.6, Math.max(0.1, oosFraction))),
  );
  const inSample = runBacktest(candles, strategy, params, cfg, 0, splitIndex);
  const outOfSample = runBacktest(candles, strategy, params, cfg, splitIndex, candles.length);
  return {
    inSample,
    outOfSample,
    splitIndex,
    verdict: verdictFor(inSample.metrics, outOfSample.metrics),
  };
}

export type SweepRow = { params: Params; inSample: Metrics; outOfSample: Metrics };
export const MAX_SWEEP = 150;

export function gridCombos(grid: Record<string, number[]>): Params[] {
  let combos: Params[] = [{}];
  for (const [key, values] of Object.entries(grid)) {
    combos = combos.flatMap((c) => values.map((v) => ({ ...c, [key]: v })));
  }
  return combos;
}

/** Ranks parameter sets by IN-SAMPLE return only (min trades required) and reports the held-out result beside each, so overfitting is visible. */
export function sweep(
  candles: Candle[],
  strategy: Strategy,
  base: Params,
  grid: Record<string, number[]>,
  cfg: BacktestConfig,
  oosFraction = 0.3,
  minTrades = 15,
  top = 5,
): SweepRow[] {
  const combos = gridCombos(grid).slice(0, MAX_SWEEP);
  const rows: SweepRow[] = [];
  for (const combo of combos) {
    const params = { ...base, ...combo };
    const r = evaluateSplit(candles, strategy, params, cfg, oosFraction);
    if (r.inSample.metrics.trades >= minTrades) {
      rows.push({
        params: clampParams(strategy, params),
        inSample: r.inSample.metrics,
        outOfSample: r.outOfSample.metrics,
      });
    }
  }
  return rows.sort((a, b) => b.inSample.returnPct - a.inSample.returnPct).slice(0, top);
}

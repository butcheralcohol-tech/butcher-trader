import { atr, ema, rsi, sma } from "./indicators.js";
import type { Candle, Signal } from "./types.js";

export type Params = Record<string, number>;
export type ParamSpec = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
};
/** `create` precomputes causal indicators once; the returned function reads index i (the candle that just CLOSED) and may only look backwards. */
export type Strategy = {
  id: string;
  name: string;
  description: string;
  params: ParamSpec[];
  create: (candles: Candle[], params: Params) => (i: number) => Signal | null;
};

export const clampParams = (strategy: Strategy, params: Params): Params =>
  Object.fromEntries(
    strategy.params.map((spec) => {
      const raw = Number(params[spec.key]);
      const value = Number.isFinite(raw) ? raw : spec.default;
      return [spec.key, Math.min(spec.max, Math.max(spec.min, value))];
    }),
  );

const stopsFor = (side: "LONG" | "SHORT", close: number, risk: number, rr: number) =>
  side === "LONG"
    ? { stop: close - risk, target: close + risk * rr }
    : { stop: close + risk, target: close - risk * rr };

export const emaCrossRsi: Strategy = {
  id: "ema-cross-rsi",
  name: "EMA cross + RSI filter",
  description:
    "Trend follower. Enters when the fast EMA crosses the slow EMA and RSI is not already stretched. ATR-based stop and reward-to-risk target.",
  params: [
    { key: "fast", label: "Fast EMA", min: 3, max: 50, step: 1, default: 9 },
    { key: "slow", label: "Slow EMA", min: 10, max: 200, step: 1, default: 21 },
    { key: "stopAtr", label: "Stop (× ATR)", min: 0.5, max: 5, step: 0.1, default: 1.5 },
    { key: "rr", label: "Reward : risk", min: 0.5, max: 5, step: 0.1, default: 2 },
  ],
  create(candles, p) {
    const closes = candles.map((c) => c.close);
    const fast = ema(closes, p.fast);
    const slow = ema(closes, p.slow);
    const r = rsi(closes, 14);
    const a = atr(candles, 14);
    return (i) => {
      if (i < 1 || p.fast >= p.slow) return null;
      if ([fast[i], slow[i], fast[i - 1], slow[i - 1], r[i], a[i]].some(Number.isNaN)) return null;
      const risk = a[i] * p.stopAtr;
      if (!(risk > 0)) return null;
      const close = candles[i].close;
      if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i] && r[i] >= 40 && r[i] <= 70) {
        return {
          side: "LONG",
          ...stopsFor("LONG", close, risk, p.rr),
          reason: `EMA${p.fast} crossed above EMA${p.slow}, RSI ${r[i].toFixed(0)}`,
        };
      }
      if (fast[i - 1] >= slow[i - 1] && fast[i] < slow[i] && r[i] >= 30 && r[i] <= 60) {
        return {
          side: "SHORT",
          ...stopsFor("SHORT", close, risk, p.rr),
          reason: `EMA${p.fast} crossed below EMA${p.slow}, RSI ${r[i].toFixed(0)}`,
        };
      }
      return null;
    };
  },
};

export const rsiReversion: Strategy = {
  id: "rsi-reversion",
  name: "RSI mean reversion",
  description:
    "Counter-trend. Buys when RSI recovers from oversold, sells when it falls back from overbought. ATR stop and reward-to-risk target.",
  params: [
    { key: "oversold", label: "Oversold level", min: 10, max: 40, step: 1, default: 30 },
    { key: "overbought", label: "Overbought level", min: 60, max: 90, step: 1, default: 70 },
    { key: "stopAtr", label: "Stop (× ATR)", min: 0.5, max: 5, step: 0.1, default: 1.5 },
    { key: "rr", label: "Reward : risk", min: 0.5, max: 5, step: 0.1, default: 1.5 },
  ],
  create(candles, p) {
    const r = rsi(candles.map((c) => c.close), 14);
    const a = atr(candles, 14);
    return (i) => {
      if (i < 1 || Number.isNaN(r[i]) || Number.isNaN(r[i - 1]) || Number.isNaN(a[i])) return null;
      const risk = a[i] * p.stopAtr;
      if (!(risk > 0)) return null;
      const close = candles[i].close;
      if (r[i - 1] < p.oversold && r[i] >= p.oversold) {
        return {
          side: "LONG",
          ...stopsFor("LONG", close, risk, p.rr),
          reason: `RSI recovered above ${p.oversold} (${r[i].toFixed(0)})`,
        };
      }
      if (r[i - 1] > p.overbought && r[i] <= p.overbought) {
        return {
          side: "SHORT",
          ...stopsFor("SHORT", close, risk, p.rr),
          reason: `RSI fell below ${p.overbought} (${r[i].toFixed(0)})`,
        };
      }
      return null;
    };
  },
};

export const donchianBreakout: Strategy = {
  id: "donchian-breakout",
  name: "Donchian channel breakout",
  description:
    "Trend-following breakout. Enters only when a closed candle breaks the previous range; ATR-based stop and fixed reward-to-risk target. Breakouts can fail in choppy markets.",
  params: [
    { key: "lookback", label: "Channel lookback", min: 8, max: 80, step: 1, default: 20 },
    { key: "stopAtr", label: "Stop (× ATR)", min: 0.5, max: 5, step: 0.1, default: 1.8 },
    { key: "rr", label: "Reward : risk", min: 0.5, max: 5, step: 0.1, default: 2 },
  ],
  create(candles, p) {
    const a = atr(candles, 14);
    const upper = candles.map((_, i) => {
      const start = Math.max(0, i - p.lookback);
      return i > 0 && i - start >= p.lookback
        ? Math.max(...candles.slice(start, i).map((c) => c.high))
        : NaN;
    });
    const lower = candles.map((_, i) => {
      const start = Math.max(0, i - p.lookback);
      return i > 0 && i - start >= p.lookback
        ? Math.min(...candles.slice(start, i).map((c) => c.low))
        : NaN;
    });
    return (i) => {
      if (i < 1 || [upper[i], lower[i], upper[i - 1], lower[i - 1], a[i]].some(Number.isNaN)) {
        return null;
      }
      const risk = a[i] * p.stopAtr;
      const close = candles[i].close;
      if (!(risk > 0)) return null;
      if (close > upper[i] && candles[i - 1].close <= upper[i - 1]) {
        return {
          side: "LONG",
          ...stopsFor("LONG", close, risk, p.rr),
          reason: `Close broke above the prior ${p.lookback}-candle range`,
        };
      }
      if (close < lower[i] && candles[i - 1].close >= lower[i - 1]) {
        return {
          side: "SHORT",
          ...stopsFor("SHORT", close, risk, p.rr),
          reason: `Close broke below the prior ${p.lookback}-candle range`,
        };
      }
      return null;
    };
  },
};

export const smaTrendPullback: Strategy = {
  id: "sma-trend-pullback",
  name: "Trend pullback (EMA + RSI)",
  description:
    "Looks for a pullback in the direction of a longer-term EMA trend, then a momentum recovery through RSI 50. No signal during indicator warm-up.",
  params: [
    { key: "trend", label: "Trend EMA", min: 20, max: 150, step: 5, default: 50 },
    { key: "stopAtr", label: "Stop (× ATR)", min: 0.5, max: 5, step: 0.1, default: 1.5 },
    { key: "rr", label: "Reward : risk", min: 0.5, max: 5, step: 0.1, default: 1.8 },
  ],
  create(candles, p) {
    const closes = candles.map((c) => c.close);
    const trend = ema(closes, p.trend);
    const momentum = rsi(closes, 14);
    const a = atr(candles, 14);
    return (i) => {
      if (i < 1 || [trend[i], momentum[i], momentum[i - 1], a[i]].some(Number.isNaN)) return null;
      const risk = a[i] * p.stopAtr;
      const close = candles[i].close;
      if (!(risk > 0)) return null;
      if (close > trend[i] && momentum[i - 1] < 50 && momentum[i] >= 50) {
        return {
          side: "LONG",
          ...stopsFor("LONG", close, risk, p.rr),
          reason: `Uptrend pullback recovered through RSI 50 (${momentum[i].toFixed(0)})`,
        };
      }
      if (close < trend[i] && momentum[i - 1] > 50 && momentum[i] <= 50) {
        return {
          side: "SHORT",
          ...stopsFor("SHORT", close, risk, p.rr),
          reason: `Downtrend pullback rolled through RSI 50 (${momentum[i].toFixed(0)})`,
        };
      }
      return null;
    };
  },
};

export const bollingerReversion: Strategy = {
  id: "bollinger-reversion",
  name: "Bollinger band reversion",
  description:
    "Mean-reversion research bot. Waits for price to re-enter the band after an outside close, with RSI confirmation. Can struggle in strong trends.",
  params: [
    { key: "period", label: "Band period", min: 10, max: 40, step: 1, default: 20 },
    { key: "deviations", label: "Std deviations", min: 1, max: 3, step: 0.1, default: 2 },
    { key: "stopAtr", label: "Stop (× ATR)", min: 0.5, max: 5, step: 0.1, default: 1.5 },
    { key: "rr", label: "Reward : risk", min: 0.5, max: 5, step: 0.1, default: 1.4 },
  ],
  create(candles, p) {
    const closes = candles.map((c) => c.close);
    const mid = sma(closes, p.period);
    const momentum = rsi(closes, 14);
    const a = atr(candles, 14);
    const upper = mid.map((m, i) => {
      if (Number.isNaN(m)) return NaN;
      const window = closes.slice(i - p.period + 1, i + 1);
      const variance = window.reduce((sum, v) => sum + (v - m) ** 2, 0) / p.period;
      return m + p.deviations * Math.sqrt(variance);
    });
    const lower = mid.map((m, i) => 2 * m - upper[i]);
    return (i) => {
      if (
        i < 1 ||
        [upper[i], lower[i], upper[i - 1], lower[i - 1], momentum[i], a[i]].some(Number.isNaN)
      ) {
        return null;
      }
      const risk = a[i] * p.stopAtr;
      const close = candles[i].close;
      if (!(risk > 0)) return null;
      if (candles[i - 1].close < lower[i - 1] && close >= lower[i] && momentum[i] < 50) {
        return {
          side: "LONG",
          ...stopsFor("LONG", close, risk, p.rr),
          reason: `Price re-entered lower Bollinger band; RSI ${momentum[i].toFixed(0)}`,
        };
      }
      if (candles[i - 1].close > upper[i - 1] && close <= upper[i] && momentum[i] > 50) {
        return {
          side: "SHORT",
          ...stopsFor("SHORT", close, risk, p.rr),
          reason: `Price re-entered upper Bollinger band; RSI ${momentum[i].toFixed(0)}`,
        };
      }
      return null;
    };
  },
};

export const strategies: Strategy[] = [
  emaCrossRsi,
  rsiReversion,
  donchianBreakout,
  smaTrendPullback,
  bollingerReversion,
];
export const getStrategy = (id: string): Strategy =>
  strategies.find((s) => s.id === id) ?? strategies[0];
export const defaultParams = (strategy: Strategy): Params =>
  Object.fromEntries(strategy.params.map((s) => [s.key, s.default]));

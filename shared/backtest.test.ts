import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BACKTEST, evaluateSplit, gridCombos, runBacktest, sweep, verdictFor } from "./backtest.js";
import { defaultParams, emaCrossRsi, rsiReversion } from "./strategy.js";
import type { Candle } from "./types.js";

// Deterministic pseudo-random walk (LCG) so tests never depend on Math.random.
function walk(n: number, seed = 7): Candle[] {
  let s = seed, price = 100;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  return Array.from({ length: n }, (_, i) => {
    const open = price, drift = Math.sin(i / 25) * 0.15, move = (rnd() - 0.5) * 1.2 + drift;
    const close = Math.max(1, open + move);
    price = close;
    return { time: 1_700_000_000 + i * 300, open, high: Math.max(open, close) + rnd() * 0.4, low: Math.min(open, close) - rnd() * 0.4, close };
  });
}
const candles = walk(1500);
const cfg = { ...DEFAULT_BACKTEST };

test("backtest is deterministic", () => {
  const a = runBacktest(candles, emaCrossRsi, defaultParams(emaCrossRsi), cfg);
  const b = runBacktest(candles, emaCrossRsi, defaultParams(emaCrossRsi), cfg);
  assert.deepEqual(a.metrics, b.metrics);
  assert.ok(a.metrics.trades > 5, "strategy should trade on 1500 candles");
});

test("NO LOOK-AHEAD: changing candles after index k never changes trades closed before k", () => {
  const k = 900;
  const base = runBacktest(candles, emaCrossRsi, defaultParams(emaCrossRsi), cfg, 0, k);
  const tampered = candles.map((c, i) => i < k ? c : { ...c, open: c.open * 3, high: c.high * 3, low: c.low * 3, close: c.close * 3 });
  const other = runBacktest(tampered, emaCrossRsi, defaultParams(emaCrossRsi), cfg, 0, k);
  assert.deepEqual(base.trades, other.trades);
});

test("equity curve ends at the final balance and metrics reconcile", () => {
  const r = runBacktest(candles, rsiReversion, defaultParams(rsiReversion), cfg);
  const net = r.trades.reduce((s, t) => s + t.pnl, 0);
  assert.ok(Math.abs(r.metrics.netPnl - net) < 1e-9);
  assert.ok(Math.abs(r.equity[r.equity.length - 1].balance - (cfg.initialBalance + net)) < 1e-6);
  assert.equal(r.metrics.wins + r.metrics.losses, r.metrics.trades);
  assert.ok(r.metrics.maxDrawdownPct >= 0 && r.metrics.maxDrawdownPct <= 100);
});

test("per-trade risk never exceeds the configured percent of balance (plus fee/slippage costs)", () => {
  const r = runBacktest(candles, emaCrossRsi, defaultParams(emaCrossRsi), { ...cfg, riskPercent: 1 });
  for (const t of r.trades) assert.ok(t.r >= -2.5, `loss ${t.r}R is beyond plausible slippage/gap`);
});

test("transaction costs lower returns", () => {
  const free = runBacktest(candles, emaCrossRsi, defaultParams(emaCrossRsi), { ...cfg, feeBps: 0, slippageBps: 0 });
  const costly = runBacktest(candles, emaCrossRsi, defaultParams(emaCrossRsi), { ...cfg, feeBps: 20, slippageBps: 10 });
  assert.ok(costly.metrics.netPnl < free.metrics.netPnl);
});

test("split evaluation uses disjoint, ordered windows", () => {
  const r = evaluateSplit(candles, emaCrossRsi, defaultParams(emaCrossRsi), cfg, 0.3);
  assert.equal(r.inSample.to, r.splitIndex);
  assert.equal(r.outOfSample.from, r.splitIndex);
  const lastIS = r.inSample.trades.at(-1)?.exitTime ?? 0, firstOOS = r.outOfSample.trades[0]?.entryTime ?? Infinity;
  assert.ok(lastIS <= firstOOS);
});

test("verdict flags in-sample winners that fail out-of-sample", () => {
  const m = (net: number, trades = 30) => ({ trades, wins: 0, losses: 0, winRate: 0, netPnl: net, returnPct: net, profitFactor: null, expectancyR: net > 0 ? 0.2 : -0.2, avgWin: 0, avgLoss: 0, maxDrawdownPct: 0, maxConsecLosses: 0, feesPaid: 0, finalBalance: 0 });
  assert.match(verdictFor(m(50), m(-20)), /overfitting/);
  assert.match(verdictFor(m(50), m(10, 3)), /Too few/);
});

test("sweep is bounded and reports out-of-sample beside in-sample", () => {
  const combos = gridCombos({ fast: [5, 9, 13], slow: [21, 34], rr: [1.5, 2] });
  assert.equal(combos.length, 12);
  const rows = sweep(candles, emaCrossRsi, defaultParams(emaCrossRsi), { fast: [5, 9], slow: [21, 34] }, cfg, 0.3, 1, 3);
  assert.ok(rows.length <= 3);
  for (const row of rows) assert.ok("outOfSample" in row && "inSample" in row);
});

test("strategy params are clamped to safe ranges", () => {
  const r = runBacktest(candles, emaCrossRsi, { fast: -5, slow: 99999, stopAtr: NaN, rr: 0 }, cfg);
  assert.ok(Number.isFinite(r.metrics.netPnl));
});

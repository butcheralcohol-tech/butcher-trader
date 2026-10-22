import test from "node:test";
import assert from "node:assert/strict";
import { createState, finalize, stepCandle, DEFAULT_SIM, type SimConfig } from "./sim.js";
import type { Candle, Signal } from "./types.js";

const cfg: SimConfig = { ...DEFAULT_SIM, feeBps: 0, slippageBps: 0, maxHoldBars: 10, riskPercent: 1, dailyLossLimitPercent: 3 };
const T = 1_700_000_000;
const c = (i: number, o: number, h: number, l: number, cl: number): Candle => ({ time: T + i * 60, open: o, high: h, low: l, close: cl });
const long: Signal = { side: "LONG", stop: 99, target: 102, reason: "test" };

test("fills at the NEXT candle open and sizes by risk (1% of 1000 = $10 over a $1 stop = 10 units)", () => {
  const s = createState(1000);
  stepCandle(s, c(0, 100, 100.5, 99.5, 100), () => long, cfg);
  assert.equal(s.position, null);
  assert.ok(s.pending);
  stepCandle(s, c(1, 100, 100.4, 99.6, 100.2), () => null, cfg);
  assert.ok(s.position);
  // TypeScript cannot infer mutations performed inside stepCandle; assert the runtime state, then narrow explicitly.
  const opened = s.position as unknown as { units: number; risk: number };
  assert.ok(Math.abs(opened.units - 10) < 1e-9);
  assert.ok(Math.abs(opened.risk - 10) < 1e-9);
});

test("target hit books a +2R win", () => {
  const s = createState(1000);
  stepCandle(s, c(0, 100, 100, 100, 100), () => long, cfg);
  stepCandle(s, c(1, 100, 100.5, 99.5, 100), () => null, cfg);
  stepCandle(s, c(2, 100, 102.5, 100, 102), () => null, cfg);
  assert.equal(s.trades.length, 1);
  assert.equal(s.trades[0].exitReason, "target");
  assert.ok(Math.abs(s.trades[0].pnl - 20) < 1e-9);
  assert.ok(Math.abs(s.trades[0].r - 2) < 1e-9);
});

test("stop is assumed first when stop and target are both inside one candle", () => {
  const s = createState(1000);
  stepCandle(s, c(0, 100, 100, 100, 100), () => long, cfg);
  stepCandle(s, c(1, 100, 103, 98, 101), () => null, cfg);
  assert.equal(s.trades[0].exitReason, "stop");
  assert.ok(s.trades[0].pnl < 0);
});

test("a gap through the stop fills at the worse open, never at the stop", () => {
  const s = createState(1000);
  stepCandle(s, c(0, 100, 100, 100, 100), () => long, cfg);
  stepCandle(s, c(1, 100, 100.5, 99.5, 100), () => null, cfg);
  stepCandle(s, c(2, 97, 97.5, 96, 96.5), () => null, cfg);
  assert.equal(s.trades[0].exit, 97);
  assert.ok(s.trades[0].r < -1);
});

test("fees and slippage reduce P&L", () => {
  const costly: SimConfig = { ...cfg, feeBps: 10, slippageBps: 5 };
  const run = (k: SimConfig) => {
    const s = createState(1000);
    stepCandle(s, c(0, 100, 100, 100, 100), () => long, k);
    stepCandle(s, c(1, 100, 100.5, 99.5, 100), () => null, k);
    stepCandle(s, c(2, 100, 102.5, 100, 102), () => null, k);
    return s.trades[0].pnl;
  };
  assert.ok(run(costly) < run(cfg));
});

test("never holds two positions and ignores new signals while one is open", () => {
  const s = createState(1000);
  for (let i = 0; i < 4; i++) stepCandle(s, c(i, 100, 100.4, 99.6, 100), () => long, cfg);
  assert.ok(s.position);
  assert.equal(s.trades.length, 0);
  assert.equal(s.nextId, 2);
});

test("timeout closes at the candle close and finalize closes an open position", () => {
  const s = createState(1000);
  const k = { ...cfg, maxHoldBars: 2 };
  stepCandle(s, c(0, 100, 100, 100, 100), () => long, k);
  stepCandle(s, c(1, 100, 100.4, 99.6, 100.1), () => null, k);
  stepCandle(s, c(2, 100.1, 100.4, 99.6, 100.2), () => null, k);
  assert.equal(s.trades[0].exitReason, "timeout");
  const f = createState(1000);
  stepCandle(f, c(0, 100, 100, 100, 100), () => long, cfg);
  stepCandle(f, c(1, 100, 100.4, 99.6, 100), () => null, cfg);
  finalize(f, c(1, 100, 100.4, 99.6, 100), cfg);
  assert.equal(f.trades[0].exitReason, "end");
});

test("daily loss lock blocks new entries after the cap is hit", () => {
  const k = { ...cfg, riskPercent: 1, dailyLossLimitPercent: 1 };
  const s = createState(1000);
  stepCandle(s, c(0, 100, 100, 100, 100), () => long, k);
  stepCandle(s, c(1, 100, 100.4, 99.6, 100), () => null, k);
  stepCandle(s, c(2, 100, 100.2, 98.5, 99), () => null, k); // stop out: -$10 = 1% of balance
  assert.equal(s.trades.length, 1);
  stepCandle(s, c(3, 99, 99.5, 98.8, 99), () => long, k);
  assert.equal(s.pending, null);
  assert.ok(s.blockedSignals >= 1);
});

test("risk above the 1% gate cap is refused", () => {
  const s = createState(1000);
  const k = { ...cfg, riskPercent: 2 };
  stepCandle(s, c(0, 100, 100, 100, 100), () => long, k);
  assert.equal(s.pending, null);
  assert.equal(s.blockedSignals, 1);
});

test("leverage cap limits position size when the stop is very tight", () => {
  const s = createState(1000);
  const tight: Signal = { side: "LONG", stop: 99.99, target: 100.5, reason: "tight" };
  stepCandle(s, c(0, 100, 100, 100, 100), () => tight, cfg);
  stepCandle(s, c(1, 100, 100.05, 99.995, 100), () => null, cfg);
  assert.ok(s.position!.units * 100 <= 1000 * cfg.maxLeverage + 1e-6);
});

test("shorts mirror longs", () => {
  const s = createState(1000);
  const short: Signal = { side: "SHORT", stop: 101, target: 98, reason: "short" };
  stepCandle(s, c(0, 100, 100, 100, 100), () => short, cfg);
  stepCandle(s, c(1, 100, 100.4, 99.6, 100), () => null, cfg);
  stepCandle(s, c(2, 100, 100.2, 97.5, 98), () => null, cfg);
  assert.equal(s.trades[0].exitReason, "target");
  assert.ok(s.trades[0].pnl > 0);
});


test("adjustable per-trade profit target closes a paper position at the configured net target", () => {
  const s = createState(1000);
  const k = { ...cfg, tradeProfitTargetAmount: 5 };
  stepCandle(s, c(0, 100, 100, 100, 100), () => long, k);
  stepCandle(s, c(1, 100, 100.4, 99.6, 100), () => null, k);
  stepCandle(s, c(2, 100, 101, 100, 100.5), () => null, k);
  assert.equal(s.trades.length, 1);
  assert.equal(s.trades[0].exitReason, "trade-profit-target");
  assert.ok(Math.abs(s.trades[0].pnl - 5) < 1e-8);
});

test("adjustable session profit target exits the open trade and blocks further entries", () => {
  const s = createState(1000);
  const k = { ...cfg, sessionProfitTargetAmount: 5 };
  stepCandle(s, c(0, 100, 100, 100, 100), () => long, k);
  stepCandle(s, c(1, 100, 100.4, 99.6, 100), () => null, k);
  stepCandle(s, c(2, 100, 101, 100, 100.5), () => null, k);
  assert.equal(s.trades.length, 1);
  assert.equal(s.trades[0].exitReason, "session-profit-target");
  assert.ok(Math.abs(s.balance - 1005) < 1e-8);
  stepCandle(s, c(3, 100.5, 100.7, 100.2, 100.5), () => long, k);
  assert.equal(s.pending, null);
  assert.ok(s.blockedSignals >= 1);
});

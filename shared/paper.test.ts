import test from "node:test";
import assert from "node:assert/strict";
import { advancePaper, combineStrategySignals, newSession, parseSession, queueManualPaperSignal, MAX_REPLAY } from "./paper.js";
import { DEFAULT_SIM } from "./sim.js";
import { defaultParams, emaCrossRsi } from "./strategy.js";
import type { Candle } from "./types.js";

const series = (n: number, start = 0): Candle[] => Array.from({ length: n }, (_, i) => {
  const t = start + i, p = 100 + Math.sin(t / 6) * 4 + t * 0.02;
  return { time: 1_700_000_000 + t * 60, open: p, high: p + 0.5, low: p - 0.5, close: p + 0.1 };
});
const metaBase = { symbol: "R_100", granularity: 60, strategyId: emaCrossRsi.id, params: defaultParams(emaCrossRsi), cfg: DEFAULT_SIM, startedAt: 0 };
const meta = metaBase;




test("ensemble combines majority signals and rejects conflicting votes", () => {
  const votes = [
    { name: "EMA", signal: { side: "LONG" as const, stop: 95, target: 110, reason: "trend up" } },
    { name: "Breakout", signal: { side: "LONG" as const, stop: 96, target: 112, reason: "range break" } },
    { name: "Reversion", signal: { side: "SHORT" as const, stop: 105, target: 90, reason: "overbought" } },
  ];
  const combined = combineStrategySignals(votes, 3, 60);
  assert.equal(combined?.side, "LONG");
  assert.equal(combined?.stop, 95.5);
  assert.equal(combined?.target, 111);
  assert.ok(combined?.reason.includes("Weighted ensemble"));
  assert.ok(combined?.reason.includes("2.00/3.00 weight"));
  assert.equal(combineStrategySignals(votes.slice(0, 2), 3, 75), null);
  assert.equal(combineStrategySignals([], 3, 60), null);
});

test("weighted ensemble lets configured strategy weights affect the direction", () => {
  const votes = [
    { name: "High-weight trend", weight: 3, signal: { side: "LONG" as const, stop: 95, target: 110, reason: "trend" } },
    { name: "Reversion", weight: 1, signal: { side: "SHORT" as const, stop: 105, target: 90, reason: "reversion" } },
    { name: "Breakout", weight: 1, signal: { side: "SHORT" as const, stop: 104, target: 91, reason: "breakdown" } },
  ];
  const result = combineStrategySignals(votes, 3, 60, [3, 1, 1]);
  assert.equal(result?.side, "LONG");
  assert.ok(result?.reason.includes("3.00/5.00 weight"));
  assert.equal(combineStrategySignals(votes, 3, 75, [3, 1, 1]), null);
});

test("multi-strategy session records enabled modules and consensus settings", () => {
  const ids = ["ema-cross-rsi", "rsi-reversion", "donchian-breakout"];
  const meta = {
    ...metaBase,
    strategyIds: ids,
    strategyParams: Object.fromEntries(ids.map(id => [id, {}])),
    consensusPercent: 60,
  };
  const session = newSession(meta, 1000);
  assert.deepEqual(session.meta.strategyIds, ids);
  assert.equal(session.meta.consensusPercent, 60);
  assert.ok(session.state.events[0].message.includes("Multi-strategy paper bot armed"));
  assert.ok(session.state.events[0].message.includes("60% directional consensus"));
  assert.ok(parseSession(JSON.parse(JSON.stringify(session))));
});


test("first call only records the starting point and never trades on history", () => {
  const s = advancePaper(newSession(meta, 1000), series(300));
  assert.equal(s.state.trades.length, 0);
  assert.equal(s.state.position, null);
  assert.ok(s.state.lastCandleTime > 0);
});

test("re-feeding the same candles (e.g. after a reconnect) is a no-op", () => {
  const started = advancePaper(newSession(meta, 1000), series(300));
  const again = advancePaper(started, series(300));
  assert.equal(again, started);
});

test("each new closed candle is processed exactly once", () => {
  let s = advancePaper(newSession(meta, 1000), series(300));
  for (let n = 301; n <= 340; n++) s = advancePaper(s, series(n));
  const ids = s.state.trades.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(s.state.lastCandleTime, series(340).at(-1)!.time);
});

test("a large feed gap skips new entries but is logged", () => {
  const started = advancePaper(newSession(meta, 1000), series(300));
  const gap = advancePaper(started, series(300 + MAX_REPLAY + 5));
  assert.ok(gap.state.events.some(e => e.message.includes("Feed gap")));
  assert.equal(gap.state.pending, null);
});

test("persisted sessions are validated before use", () => {
  const ok = advancePaper(newSession(meta, 1000), series(300));
  assert.ok(parseSession(JSON.parse(JSON.stringify(ok))));
  assert.equal(parseSession({ version: 2 }), null);
  assert.equal(parseSession(null), null);
  assert.equal(parseSession({ ...ok, state: { ...ok.state, balance: "x" } }), null);
});

test("manual paper orders queue with bounded stop and reward/risk and reject duplicate entries", () => {
  const started = advancePaper(newSession(meta, 1000), series(300));
  const long = queueManualPaperSignal(started, "LONG", 100, 0.5, 2);
  assert.ok(long);
  assert.equal(long.state.pending?.side, "LONG");
  assert.equal(long.state.pending?.stop, 99.5);
  assert.equal(long.state.pending?.target, 101);
  assert.ok(long.state.events.at(-1)?.message.includes("Manual PAPER LONG"));
  assert.equal(queueManualPaperSignal(long, "SHORT", 100, 0.5, 2), null);
  assert.equal(queueManualPaperSignal(started, "LONG", 100, 0.01, 2), null);
  assert.equal(queueManualPaperSignal(started, "SHORT", 100, 0.5, 6), null);
});

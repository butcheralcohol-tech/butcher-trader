import test from "node:test";
import assert from "node:assert/strict";
import { advancePaper, newSession, parseSession, MAX_REPLAY } from "./paper.js";
import { DEFAULT_SIM } from "./sim.js";
import { defaultParams, emaCrossRsi } from "./strategy.js";
import type { Candle } from "./types.js";

const series = (n: number, start = 0): Candle[] => Array.from({ length: n }, (_, i) => {
  const t = start + i, p = 100 + Math.sin(t / 6) * 4 + t * 0.02;
  return { time: 1_700_000_000 + t * 60, open: p, high: p + 0.5, low: p - 0.5, close: p + 0.1 };
});
const metaBase = { symbol: "R_100", granularity: 60, strategyId: emaCrossRsi.id, params: defaultParams(emaCrossRsi), cfg: DEFAULT_SIM, startedAt: 0 };
const meta = metaBase;



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

\ntest("first call only records the starting point and never trades on history", () => {
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

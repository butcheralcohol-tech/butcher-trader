import test from "node:test";
import assert from "node:assert/strict";
import { buildMeta, closedCandles, initWorkerState, parseWorkerState, stepWorker, type WorkerSettings } from "./worker-core.js";
import type { Candle } from "./types.js";

const S: WorkerSettings = { symbol: "R_100", granularity: 60, strategyIds: ["ema-cross-rsi"], consensusPercent: 60, balance: 1000 };

// Deterministic random walk (seeded) so strategies have something to trade.
const ALL: Candle[] = (() => {
  let seed = 7, p = 100; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 1500 }, (_, k) => { const o = p; p += (rnd() - 0.5) * 3 + Math.sin(k / 15) * 0.8; return { time: 1_700_000_000 + k * 60, open: o, high: Math.max(o, p) + rnd(), low: Math.min(o, p) - rnd(), close: p }; });
})();
const candles = (n: number): Candle[] => ALL.slice(0, n);
const T: WorkerSettings = { ...S, strategyIds: ["bollinger-reversion"], consensusPercent: 50 };

test("buildMeta rejects unknown strategy ids and builds a valid meta", () => {
  assert.throws(() => buildMeta({ ...S, strategyIds: [] }));
  assert.throws(() => buildMeta({ ...S, consensusPercent: 34 }), /between 50 and 100/);
  assert.throws(() => buildMeta({ ...S, balance: 0 }), /minimum/);
  const m = buildMeta(S, 5); assert.equal(m.startedAt, 5); assert.equal(m.symbol, "R_100"); assert.deepEqual(m.strategyIds, [m.strategyId]);
});

test("the in-progress candle is never treated as closed", () => {
  assert.equal(closedCandles(candles(10)).length, 9);
});

test("init never turns pre-existing history into orders", () => {
  const history = candles(300);
  const st = initWorkerState(S, history);
  const r = stepWorker(st, history);
  assert.equal(r.orders.length, 0);
});

test("the same candles are never processed twice; each fill yields exactly one order across a long run", () => {
  let st = initWorkerState(T, candles(200));
  const sent = new Set<string>(); let dup = 0, total = 0;
  for (let n = 201; n <= 1500; n++) {
    const r = stepWorker(st, candles(n));
    const again = stepWorker(r.state, candles(n)); // same data re-polled
    assert.equal(again.orders.length, 0, "re-poll must not emit");
    for (const o of r.orders) { total++; if (sent.has(o.idempotencyKey)) dup++; sent.add(o.idempotencyKey); }
    st = r.state;
  }
  assert.equal(dup, 0);
  const fills = st.session.state.events.filter((e) => e.type === "FILLED").length;
  assert.ok(total > 0, "expected at least one entry");
  assert.equal(total, fills, "exactly one order per paper fill");
});

test("state survives a JSON round-trip (restart) without replaying orders", () => {
  let st = initWorkerState(T, candles(200));
  for (let n = 201; n <= 1500; n++) st = stepWorker(st, candles(n)).state;
  const revived = parseWorkerState(JSON.parse(JSON.stringify(st)));
  assert.ok(revived);
  assert.equal(stepWorker(revived!, candles(1500)).orders.length, 0);
});

test("corrupt persisted state is rejected", () => {
  for (const bad of [null, {}, { version: 2 }, { version: 1, session: null, handledUpTo: 0, lastCandleTime: 0 }]) assert.equal(parseWorkerState(bad), null);
});

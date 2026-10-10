import test from "node:test";
import assert from "node:assert/strict";
import { backoffDelay, mergeCandle, parseHistory, parseOhlc } from "./candles.js";

test("parseHistory sorts, de-duplicates and drops malformed rows", () => {
  const out = parseHistory({ candles: [
    { epoch: 120, open: "2", high: "3", low: "1", close: "2.5" },
    { epoch: 60, open: 1, high: 2, low: 0.5, close: 1.5 },
    { epoch: 60, open: 1, high: 2, low: 0.5, close: 1.6 },
    { epoch: 180, open: 1, high: 0.5, low: 2, close: 1 },
    { epoch: 240, open: "x", high: 1, low: 1, close: 1 },
    null,
  ] });
  assert.deepEqual(out.map(c => c.time), [60, 120]);
  assert.equal(out[0].close, 1.6);
  assert.deepEqual(parseHistory({}), []);
});

test("parseOhlc keys by open_time", () => {
  assert.deepEqual(parseOhlc({ ohlc: { open_time: 600, open: "1", high: "2", low: "1", close: "1.5" } }), { time: 600, open: 1, high: 2, low: 1, close: 1.5 });
  assert.equal(parseOhlc({ ohlc: { open_time: "bad" } }), null);
});

test("mergeCandle replaces the forming candle, appends new ones, ignores unknown old ones", () => {
  const a = { time: 60, open: 1, high: 2, low: 1, close: 1.5 }, b = { ...a, time: 120 };
  let list = mergeCandle([], a);
  list = mergeCandle(list, { ...a, close: 1.8 });
  assert.equal(list.length, 1); assert.equal(list[0].close, 1.8);
  list = mergeCandle(list, b);
  assert.equal(list.length, 2);
  assert.equal(mergeCandle(list, { ...a, time: 30 }), list);
  assert.equal(mergeCandle(list, { ...b, time: 180 }, 2).length, 2);
  assert.equal(mergeCandle(list, { ...b, time: 180 }, 2)[0].time, 120);
});

test("backoff grows, caps at 30s and applies jitter", () => {
  assert.equal(backoffDelay(0, () => 1), 1000);
  assert.equal(backoffDelay(3, () => 1), 8000);
  assert.equal(backoffDelay(20, () => 1), 30000);
  assert.equal(backoffDelay(2, () => 0), 2000);
});

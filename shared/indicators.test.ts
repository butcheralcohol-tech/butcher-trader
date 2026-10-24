import test from "node:test";
import assert from "node:assert/strict";
import { atr, ema, rsi, sma } from "./indicators.js";
import type { Candle } from "./types.js";

const close = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test("sma uses a rolling window and NaN warm-up", () => {
  const out = sma([1, 2, 3, 4, 5], 3);
  assert.ok(Number.isNaN(out[0]) && Number.isNaN(out[1]));
  assert.deepEqual(out.slice(2), [2, 3, 4]);
});

test("ema seeds with the SMA then smooths", () => {
  const out = ema([1, 2, 3, 4, 5], 3);
  close(out[2], 2);
  close(out[3], 3); // 4*0.5 + 2*0.5
  close(out[4], 4);
});

test("rsi is 100 on a pure uptrend, 0 on a pure downtrend and 50 when flat", () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const down = Array.from({ length: 30 }, (_, i) => 100 - i);
  assert.equal(rsi(up)[29], 100);
  assert.equal(rsi(down)[29], 0);
  assert.equal(rsi(new Array(30).fill(5))[29], 50);
});

test("atr of constant-range candles equals the range", () => {
  const candles: Candle[] = Array.from({ length: 20 }, (_, i) => ({
    time: i,
    open: 10,
    high: 12,
    low: 10,
    close: 11,
  }));
  close(atr(candles, 14)[19], 2);
});

test("indicators are causal: truncating future data does not change earlier values", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1);
  const full = rsi(closes);
  const part = rsi(closes.slice(0, 40));
  for (let i = 0; i < 40; i++) {
    assert.ok(Object.is(full[i], part[i]) || Math.abs(full[i] - part[i]) < 1e-12);
  }
});

test("invalid periods return all NaN instead of throwing", () => {
  assert.ok(sma([1, 2], 0).every(Number.isNaN));
  assert.ok(ema([1, 2], 5).every(Number.isNaN));
});

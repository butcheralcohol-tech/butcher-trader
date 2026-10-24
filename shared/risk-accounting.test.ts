import test from "node:test";
import assert from "node:assert/strict";
import { computeRiskTotals, normalizeTrade } from "./risk-accounting.js";

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const sec = (h: number) => Math.floor(NOW / 1000) - h * 3600;

test("legacy rows: profit, underlying, numeric sell_time", () => {
  const r = computeRiskTotals([{ profit: -3, underlying: "R_100", sell_time: sec(1) }, { profit: 5, underlying: "R_50", sell_time: sec(2) }], "R_100", NOW);
  assert.deepEqual(r, { dailyNetPnl: 2, marketNetPnl: -3, sessionNetPnl: 2, closedToday: 2 });
});

test("new-API rows: derived profit, shortcode symbol, ISO and string times", () => {
  const r = computeRiskTotals([
    { buy_price: "5", sell_price: "0", shortcode: "CALL_R_100_5_1_2_S0P_0", sell_time: new Date(sec(1) * 1000).toISOString() },
    { buy_price: 5, sell_price: 9.5, underlying_symbol: "1HZ100V", sell_time: String(sec(1)) },
  ], "R_100", NOW);
  assert.equal(r.dailyNetPnl, -0.5); assert.equal(r.marketNetPnl, -5);
});

test("millisecond timestamps are normalised", () => {
  assert.equal(normalizeTrade({ profit: 1, symbol: "R_10", sell_time: sec(1) * 1000 })?.sellTime, sec(1));
});

test("old trades count towards neither daily nor session totals", () => {
  const r = computeRiskTotals([{ profit: -50, symbol: "R_100", sell_time: sec(40) }], "R_100", NOW);
  assert.equal(r.dailyNetPnl, 0); assert.equal(r.closedToday, 0);
});

test("fails closed on unreadable rows, missing array, and truncated history", () => {
  assert.throws(() => computeRiskTotals([{ contract_id: 1 }], "R_100", NOW), /missing timestamps/);
  assert.throws(() => computeRiskTotals([null], "R_100", NOW), /missing timestamps/);
  assert.throws(() => computeRiskTotals(undefined, "R_100", NOW), /unavailable/);
  assert.throws(() => computeRiskTotals(Array.from({ length: 500 }, () => ({ profit: 1, symbol: "R_100", sell_time: sec(1) })), "R_100", NOW), /query limit/);
});

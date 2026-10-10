import test from "node:test";
import assert from "node:assert/strict";
import { parseRiskInput } from "./validate.js";

const good = { balance: 1000, riskPercent: 0.5, dailyLossLimitPercent: 2, dailyPnl: 0, openPositions: 0, maxOpenPositions: 1, liveEnabled: false };

test("accepts a well-formed body", () => assert.equal(parseRiskInput(good).ok, true));
test("rejects non-objects and arrays", () => {
  for (const bad of [null, 5, "x", [], undefined]) assert.equal(parseRiskInput(bad).ok, false);
});
test("rejects NaN-like and string numbers", () => {
  assert.equal(parseRiskInput({ ...good, balance: "1000" }).ok, false);
  assert.equal(parseRiskInput({ ...good, riskPercent: Infinity }).ok, false);
});
test("requires boolean liveEnabled", () => assert.equal(parseRiskInput({ ...good, liveEnabled: "no" }).ok, false));
test("drops unknown fields", () => {
  const parsed = parseRiskInput({ ...good, extra: 1 });
  assert.ok(parsed.ok && !("extra" in parsed.value));
});

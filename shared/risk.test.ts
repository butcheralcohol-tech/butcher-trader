import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRisk } from "./risk.js";

const base = { balance: 1000, riskPercent: 0.5, dailyLossLimitPercent: 2, dailyPnl: 0, openPositions: 0, maxOpenPositions: 1, liveEnabled: false };

test("allows a valid conservative demo risk check", () => {
  const result = evaluateRisk(base);
  assert.equal(result.allowed, true);
  assert.equal(result.maxRiskAmount, 5);
  assert.deepEqual(result.reasons, []);
});

test("blocks trading at the daily loss cap", () => {
  const result = evaluateRisk({ ...base, dailyPnl: -20 });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some(reason => reason.includes("Daily loss limit")));
});

test("blocks a second open position at the configured limit", () => {
  const result = evaluateRisk({ ...base, openPositions: 1 });
  assert.equal(result.allowed, false);
});

test("never permits live execution in this milestone", () => {
  const result = evaluateRisk({ ...base, liveEnabled: true });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some(reason => reason.includes("Live execution")));
});

test("rejects risk above one percent", () => {
  assert.equal(evaluateRisk({ ...base, riskPercent: 1.5 }).allowed, false);
});
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRisk } from "./risk.js";

const base = {
  balance: 1000,
  riskPercent: 1,
  dailyLossLimitPercent: 2,
  dailyLossLimitAmount: 20,
  dailyProfitTargetAmount: 40,
  dailyPnl: 0,
  openPositions: 0,
  maxOpenPositions: 1,
  liveEnabled: false,
};

test("allows a valid demo risk check and sizes at one percent", () => {
  const result = evaluateRisk(base);
  assert.equal(result.allowed, true);
  assert.equal(result.maxRiskAmount, 10);
  assert.deepEqual(result.reasons, []);
});

test("blocks trading at the configured absolute daily loss cap", () => {
  const result = evaluateRisk({ ...base, dailyPnl: -20 });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((reason) => reason.includes("Daily loss limit")));
});

test("absolute loss cap wins even if percentage cap is looser", () => {
  const result = evaluateRisk({ ...base, balance: 5000, dailyLossLimitPercent: 3, dailyPnl: -20 });
  assert.equal(result.allowed, false);
});

test("pauses new entries at the daily profit target", () => {
  const result = evaluateRisk({ ...base, dailyPnl: 40 });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((reason) => reason.includes("profit target")));
});

test("blocks a second open position at the configured limit", () => {
  assert.equal(evaluateRisk({ ...base, openPositions: 1 }).allowed, false);
});

test("never permits live execution in this milestone", () => {
  const result = evaluateRisk({ ...base, liveEnabled: true });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((reason) => reason.includes("Live execution")));
});

test("rejects risk above one percent", () => {
  assert.equal(evaluateRisk({ ...base, riskPercent: 1.5 }).allowed, false);
});

test("rejects invalid absolute loss caps", () => {
  assert.equal(evaluateRisk({ ...base, dailyLossLimitAmount: 0 }).allowed, false);
});

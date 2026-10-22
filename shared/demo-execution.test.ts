import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDemoExecutionRisk } from "./demo-execution.js";

const base = {
  account: { loginid: "VRTC1234567", is_virtual: 1 as const, currency: "USD", balance: 1000 },
  stake: 10, dailyNetPnl: 0, dailyLossLimitUsd: 20, dailyProfitTargetUsd: 40,
  riskPercent: 1, openContracts: 0, maxOpenContracts: 1,
};

test("permits a valid demo order at or below 1% of broker balance", () => {
  assert.deepEqual(evaluateDemoExecutionRisk(base), { allowed: true, reasons: [], maxStake: 10 });
});
test("blocks real accounts even if caller claims they are demo", () => {
  const decision = evaluateDemoExecutionRisk({ ...base, account: { ...base.account, loginid: "CR123456", is_virtual: 0 } });
  assert.equal(decision.allowed, false);
  assert.ok(decision.reasons.some((reason) => reason.includes("virtual account")));
});
test("blocks an order that exceeds 1% of broker balance", () => {
  assert.equal(evaluateDemoExecutionRisk({ ...base, stake: 10.01 }).allowed, false);
});
test("blocks at the daily loss limit", () => {
  assert.ok(evaluateDemoExecutionRisk({ ...base, dailyNetPnl: -20 }).reasons.some((reason) => reason.includes("loss cap")));
});
test("blocks after the daily profit target is reached", () => {
  assert.ok(evaluateDemoExecutionRisk({ ...base, dailyNetPnl: 40 }).reasons.some((reason) => reason.includes("profit target")));
});
test("blocks while another contract is open", () => {
  assert.equal(evaluateDemoExecutionRisk({ ...base, openContracts: 1 }).allowed, false);
});
test("fails closed on non-finite broker values", () => {
  assert.equal(evaluateDemoExecutionRisk({ ...base, account: { ...base.account, balance: Number.NaN } }).allowed, false);
});

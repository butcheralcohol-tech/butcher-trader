import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLiveExecutionPreflight, type LiveExecutionPreflight } from "./live-execution-gate.js";

const complete: LiveExecutionPreflight = {
  explicitApproval: true,
  oauthSessionVerified: true,
  brokerAccountId: "CR123456",
  brokerAccountType: "real",
  demoOrderLifecycleVerified: true,
  brokerSettlementReconciliationVerified: true,
  persistentWorkerHealthy: true,
  durableRiskStoreHealthy: true,
  cumulativeHardStopEnforced: true,
  hardStopClosesSocketAndStopsWorker: true,
  minimumStakeValidated: true,
  singleOrderFirstRunEnforced: true,
  marketHoursChecked: true,
  perTradeRiskLimitEnforced: true,
  perMarketLossLimitEnforced: true,
  sessionLossLimitEnforced: true,
  dailyLossLimitEnforced: true,
};

test("live gate fails closed under the current demo-only deployment policy", () => {
  const result = evaluateLiveExecutionPreflight(complete);
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some(reason => reason.includes("deployment policy")));
});

test("all checks pass only when reviewed policy explicitly permits live orders", () => {
  assert.deepEqual(evaluateLiveExecutionPreflight(complete, true), { allowed: true, reasons: [] });
});

test("rejects wallet accounts even if every other check passes", () => {
  const result = evaluateLiveExecutionPreflight({ ...complete, brokerAccountId: "CRW123456", brokerAccountType: "wallet" }, true);
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some(reason => reason.includes("Only a broker-verified CR real account")));
});

test("rejects virtual accounts even when account ID is forged as a real account", () => {
  const result = evaluateLiveExecutionPreflight({ ...complete, brokerAccountId: "VRTC123456", brokerAccountType: "real" }, true);
  assert.equal(result.allowed, false);
});

test("a missing hard-stop action or risk control independently blocks execution", () => {
  for (const key of ["cumulativeHardStopEnforced", "hardStopClosesSocketAndStopsWorker", "perTradeRiskLimitEnforced", "perMarketLossLimitEnforced", "sessionLossLimitEnforced", "dailyLossLimitEnforced"] as const) {
    const result = evaluateLiveExecutionPreflight({ ...complete, [key]: false }, true);
    assert.equal(result.allowed, false, key);
    assert.ok(result.reasons.length > 0, key);
  }
});

test("missing demo validation or broker reconciliation independently blocks execution", () => {
  assert.equal(evaluateLiveExecutionPreflight({ ...complete, demoOrderLifecycleVerified: false }, true).allowed, false);
  assert.equal(evaluateLiveExecutionPreflight({ ...complete, brokerSettlementReconciliationVerified: false }, true).allowed, false);
});

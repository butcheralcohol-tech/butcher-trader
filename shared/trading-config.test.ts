import test from "node:test";
import assert from "node:assert/strict";
import { canEnableLiveTrading, liveExecutionBlockers, TRADING_POLICY } from "./trading-config.js";

test("uses requested both-markets risk policy while locked to demo", () => {
  assert.deepEqual(TRADING_POLICY.markets, ["SYNTHETIC", "FOREX"]);
  assert.equal(TRADING_POLICY.riskPercent, 1);
  assert.equal(TRADING_POLICY.dailyLossLimitPercent, 3);
  assert.equal(TRADING_POLICY.dailyLossAction, "PAUSE_UNTIL_NEXT_DAY");
  assert.equal(TRADING_POLICY.maxOpenPositions, 1);
  assert.equal(TRADING_POLICY.liveTradingEnabled, false);
});

test("live execution remains impossible from config flags alone", () => {
  assert.equal(canEnableLiveTrading({
    oauthImplemented: true,
    demoOrdersVerified: true,
    safetyReviewPassed: true,
    explicitApproval: true,
  }), false);
});

test("live execution remains locked if any prerequisite is missing", () => {
  assert.equal(canEnableLiveTrading({
    oauthImplemented: false,
    demoOrdersVerified: true,
    safetyReviewPassed: true,
    explicitApproval: true,
  }), false);
});

test("live readiness fails closed when evidence is absent", () => {
  assert.deepEqual(liveExecutionBlockers(undefined), ["readiness evidence is missing"]);
});

test("wallet, demo, malformed account IDs, and incomplete lifecycle evidence are blocked", () => {
  const blockers = liveExecutionBlockers({
    oauthImplemented: true,
    brokerAccountVerified: true,
    accountType: "wallet",
    accountId: "CR12345",
    demoOrdersVerified: true,
    settlementReconciliationVerified: true,
    durableRiskStoreVerified: true,
    atomicLossGuardVerified: true,
    emergencyStopVerified: true,
    marketHoursVerified: true,
    singleOrderFirstRunEnabled: true,
    explicitApproval: true,
    safetyReviewPassed: true,
  });
  assert.ok(blockers.some(reason => reason.includes("real CR account")));
  assert.ok(blockers.some(reason => reason.includes("release policy")));
});

test("even complete readiness evidence cannot override the demo-only release policy", () => {
  const blockers = liveExecutionBlockers({
    oauthImplemented: true,
    brokerAccountVerified: true,
    accountType: "real",
    accountId: "CR12345",
    demoOrdersVerified: true,
    settlementReconciliationVerified: true,
    durableRiskStoreVerified: true,
    atomicLossGuardVerified: true,
    emergencyStopVerified: true,
    marketHoursVerified: true,
    singleOrderFirstRunEnabled: true,
    explicitApproval: true,
    safetyReviewPassed: true,
  });
  assert.deepEqual(blockers, ["live execution is disabled by the release policy"]);
});

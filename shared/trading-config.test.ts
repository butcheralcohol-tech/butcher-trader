import test from "node:test";
import assert from "node:assert/strict";
import { canEnableLiveTrading, TRADING_POLICY } from "./trading-config.js";

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

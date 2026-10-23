import test from "node:test";
import assert from "node:assert/strict";
import { checkWorkerRisk, isMarketSessionOpen, type WorkerRiskState, type WorkerRiskConfig } from "./worker-risk.js";

const state: WorkerRiskState = {
  accountId: "VRTC123456", currency: "USD", startingBalance: 1000,
  realizedNetPnl: 0, sessionNetPnl: 0, marketNetPnl: { R_100: 0 },
  openContractIds: [], halted: false,
};
const config: WorkerRiskConfig = {
  maxStakePercent: 1, dailyLossLimitUsd: 20, sessionLossLimitUsd: 20,
  marketLossLimitUsd: { R_100: 20 }, dailyProfitTargetUsd: 40,
  minimumStake: 2, maximumOpenContracts: 1,
};
const check = (overrides: Partial<Parameters<typeof checkWorkerRisk>[0]> = {}) =>
  checkWorkerRisk({ state, config, market: "R_100", stake: 2, brokerBalance: 1000, brokerOpenContractIds: [], ...overrides });

test("allows a minimum stake demo order when broker state is clear", () => {
  assert.equal(check().allowed, true);
});
test("rejects wallet, real and unknown account IDs", () => {
  assert.equal(check({ state: { ...state, accountId: "CRW123" } }).allowed, false);
  assert.equal(check({ state: { ...state, accountId: "CR123" } }).allowed, false);
});
test("enforces daily, session and market hard stops", () => {
  assert.ok(check({ state: { ...state, realizedNetPnl: -20 } }).reasons.includes("Daily hard stop reached."));
  assert.ok(check({ state: { ...state, sessionNetPnl: -20 } }).reasons.includes("Session hard stop reached."));
  assert.ok(check({ state: { ...state, marketNetPnl: { R_100: -20 } } }).reasons.includes("Market hard stop reached or market limit missing."));
});
test("blocks missing market-specific limits and unknown risk state", () => {
  assert.equal(check({ market: "R_50" }).allowed, false);
  assert.equal(check({ brokerBalance: Number.NaN }).allowed, false);
});
test("blocks after target, when halted, or when any contract is open", () => {
  assert.equal(check({ state: { ...state, realizedNetPnl: 40 } }).allowed, false);
  assert.equal(check({ state: { ...state, halted: true } }).allowed, false);
  assert.equal(check({ brokerOpenContractIds: [123] }).allowed, false);
});
test("applies minimum stake and 1% max stake even with small balances", () => {
  assert.equal(check({ stake: 1 }).allowed, false);
  assert.equal(check({ stake: 10.01 }).allowed, false);
  assert.equal(check({ brokerBalance: 100, stake: 2 }).allowed, false);
});
test("synthetics remain available while FX session is closed", () => {
  const saturday = new Date("2026-10-24T12:00:00Z");
  assert.equal(isMarketSessionOpen("synthetic", saturday), true);
  assert.equal(isMarketSessionOpen("forex", saturday), false);
  assert.equal(isMarketSessionOpen("forex", new Date("2026-10-23T12:00:00Z")), true);
});

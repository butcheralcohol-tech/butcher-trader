import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRealExecutionRisk, isHalted, loadRealConfig, REAL_CONFIRM_PHRASE, REAL_ENABLE_VALUE, type RealConfig, type RealEnv } from "./real-gate.js";

const env: RealEnv = { ALLOW_REAL_TRADING: REAL_ENABLE_VALUE, REAL_ACCOUNT_ALLOWLIST: "CR123456", REAL_MAX_STAKE: "2", REAL_DAILY_LOSS_LIMIT: "10" };
const cfg = (loadRealConfig(env) as { ok: true; config: RealConfig }).config;
const base = { account: { loginid: "CR123456", is_virtual: 0 as const, currency: "USD", balance: 500 }, stake: 2, dailyNetPnl: 0, openContracts: 0, maxOpenContracts: 1, config: cfg, confirmation: REAL_CONFIRM_PHRASE, demoOrdersConfirmed: 30 };

test("real trading is off unless every server setting is deliberately present", () => {
  assert.equal(loadRealConfig({}).ok, false);
  assert.equal(loadRealConfig({ ...env, ALLOW_REAL_TRADING: "true" }).ok, false);
  assert.equal(loadRealConfig({ ...env, REAL_ACCOUNT_ALLOWLIST: "" }).ok, false);
  assert.equal(loadRealConfig({ ...env, REAL_ACCOUNT_ALLOWLIST: "VRTC1" }).ok, false);
  assert.equal(loadRealConfig({ ...env, REAL_MAX_STAKE: undefined }).ok, false);
  assert.equal(loadRealConfig({ ...env, REAL_DAILY_LOSS_LIMIT: "0" }).ok, false);
  assert.equal(loadRealConfig({ ...env, REAL_MIN_DEMO_ORDERS: "5" }).ok, false);
  assert.equal(loadRealConfig(env).ok, true);
});

test("a fully compliant order is allowed", () => assert.equal(evaluateRealExecutionRisk(base).allowed, true));

test("each independent gate blocks on its own", () => {
  const blocked = (patch: object) => evaluateRealExecutionRisk({ ...base, ...patch }).allowed === false;
  assert.ok(blocked({ confirmation: "yes" }));
  assert.ok(blocked({ confirmation: undefined }));
  assert.ok(blocked({ demoOrdersConfirmed: 29 }));
  assert.ok(blocked({ account: { ...base.account, loginid: "CR999999" } }));
  assert.ok(blocked({ account: { ...base.account, is_virtual: 1 as const, loginid: "VRTC1" } }));
  assert.ok(blocked({ openContracts: 1 }));
  assert.ok(blocked({ stake: 2.01 }));
  assert.ok(blocked({ stake: NaN }));
  assert.ok(blocked({ dailyNetPnl: -10 }));
});

test("stake is capped at 1% of balance even when the env cap is higher", () => {
  const r = evaluateRealExecutionRisk({ ...base, account: { ...base.account, balance: 100 }, config: { ...cfg, maxStake: 50 }, stake: 1.5 });
  assert.equal(r.maxStake, 1);
  assert.equal(r.allowed, false);
});

test("daily loss cap is the stricter of the env limit and 3% of balance", () => {
  const small = { ...base.account, balance: 100 }; // 3% = $3, env says $10
  assert.equal(evaluateRealExecutionRisk({ ...base, account: small, stake: 1, dailyNetPnl: -2.9 }).allowed, true);
  assert.equal(evaluateRealExecutionRisk({ ...base, account: small, stake: 1, dailyNetPnl: -3 }).allowed, false);
});

test("kill switch recognises common truthy values only", () => {
  for (const v of ["1", "true", "TRUE", "yes", "on"]) assert.ok(isHalted({ TRADING_HALTED: v }));
  for (const v of [undefined, "", "0", "false", "no"]) assert.ok(!isHalted({ TRADING_HALTED: v }));
});

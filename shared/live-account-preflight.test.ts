import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLivePreflight } from "./live-account-preflight.js";

const base = {
  account: { account_id: "CR12345678", account_type: "trading", currency: "USD", status: "active" },
  tokenScopes: ["read", "trade"],
  otpUrl: "wss://api.derivws.com/trading/v1/options/ws/real?otp=opaque",
  maxOrdersPerRun: 1,
  maxStake: 0.35,
  accountBalance: 100,
};

test("accepts a minimally configured real trading account preflight", () => {
  assert.deepEqual(evaluateLivePreflight(base), { allowed: true, reasons: [] });
});

test("rejects wallet and virtual account identifiers", () => {
  for (const account_id of ["CRW12345", "VRW12345", "VRTC12345", "CRW123"]) {
    assert.equal(
      evaluateLivePreflight({ ...base, account: { ...base.account, account_id } }).allowed,
      false,
    );
  }
});

test("requires read and trade scopes and rejects elevated scopes", () => {
  assert.equal(evaluateLivePreflight({ ...base, tokenScopes: ["read"] }).allowed, false);
  assert.equal(evaluateLivePreflight({ ...base, tokenScopes: ["trade"] }).allowed, false);
  assert.equal(
    evaluateLivePreflight({ ...base, tokenScopes: ["read", "trade", "payments"] }).allowed,
    false,
  );
});

test("rejects demo OTP URLs and arbitrary hosts", () => {
  assert.equal(
    evaluateLivePreflight({
      ...base,
      otpUrl: "wss://api.derivws.com/trading/v1/options/ws/demo?otp=x",
    }).allowed,
    false,
  );
  assert.equal(
    evaluateLivePreflight({ ...base, otpUrl: "wss://evil.example/ws/real?otp=x" }).allowed,
    false,
  );
});

test("enforces a one-order run and 1% first-run stake ceiling", () => {
  assert.equal(evaluateLivePreflight({ ...base, maxOrdersPerRun: 2 }).allowed, false);
  assert.equal(evaluateLivePreflight({ ...base, maxStake: 1.01 }).allowed, false);
});

test("rejects missing or invalid broker account data", () => {
  assert.equal(evaluateLivePreflight({ ...base, accountBalance: 0 }).allowed, false);
  assert.equal(
    evaluateLivePreflight({ ...base, account: { ...base.account, currency: "" } }).allowed,
    false,
  );
});

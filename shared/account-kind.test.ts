import test from "node:test";
import assert from "node:assert/strict";
import { classifyAccount, otpEnvironment } from "./account-kind.js";

test("classifies demo, real and unsupported account IDs", () => {
  assert.equal(classifyAccount("VRTC1234567"), "demo");
  assert.equal(classifyAccount(" vrtc12 "), "demo");
  assert.equal(classifyAccount("DOT91216789"), "demo");
  assert.equal(classifyAccount("CR1234567"), "real");
  assert.equal(classifyAccount("ROT123"), "real");
  for (const id of ["CRW123", "VRW123", "MF123", "", "CR", "CR12x"]) assert.equal(classifyAccount(id), "unsupported", id);
});

test("OTP URL environment is read from the broker-issued path, and lookalikes are rejected", () => {
  assert.equal(otpEnvironment("wss://api.derivws.com/trading/v1/options/ws/demo?otp=a"), "demo");
  assert.equal(otpEnvironment("wss://api.derivws.com/trading/v1/options/ws/real?otp=a"), "real");
  assert.equal(otpEnvironment("wss://api.derivws.com/trading/v1/options/ws/public"), null);
  assert.equal(otpEnvironment("ws://api.derivws.com/trading/v1/options/ws/real?otp=a"), null);
  assert.equal(otpEnvironment("wss://evil.example/trading/v1/options/ws/real?otp=a"), null);
  assert.equal(otpEnvironment("wss://api.derivws.com.evil.example/trading/v1/options/ws/real"), null);
  assert.equal(otpEnvironment("not a url"), null);
});

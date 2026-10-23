import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOptionsProposal } from "./deriv-options.js";

test("builds Deriv Options proposals with underlying_symbol", () => {
  const proposal = buildOptionsProposal({
    underlyingSymbol: "R_100",
    contractType: "CALL",
    currency: "USD",
    stake: 2,
    duration: 5,
    durationUnit: "m",
  });
  assert.equal(proposal.underlying_symbol, "R_100");
  assert.equal("symbol" in proposal, false);
  assert.equal(proposal.basis, "stake");
});

test("rejects invalid stake, symbol, and duration before any broker request", () => {
  const base = {
    underlyingSymbol: "R_100",
    contractType: "CALL",
    currency: "USD",
    stake: 2,
    duration: 5,
    durationUnit: "m" as const,
  };
  assert.throws(() => buildOptionsProposal({ ...base, stake: 0 }), /Stake must be positive/);
  assert.throws(() => buildOptionsProposal({ ...base, underlyingSymbol: "R 100" }), /Invalid underlying symbol/);
  assert.throws(() => buildOptionsProposal({ ...base, duration: 0 }), /Duration must be a positive integer/);
});

test("rejects real and wallet accounts before issuing an OTP request", async () => {
  let fetchCalled = false;
  await assert.rejects(
    () => import("./deriv-options.js").then(({ DerivOptionsClient }) => DerivOptionsClient.connect({
      accessToken: "test-token",
      accountId: "CR123456",
      fetchImpl: (async () => { fetchCalled = true; throw new Error("must not run"); }) as typeof fetch,
    })),
    /Only Deriv virtual trading accounts are enabled/,
  );
  assert.equal(fetchCalled, false);
});

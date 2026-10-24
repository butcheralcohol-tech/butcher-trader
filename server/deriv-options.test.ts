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
    () =>
      import("./deriv-options.js").then(({ DerivOptionsClient }) =>
        DerivOptionsClient.connect({
          accessToken: "test-token",
          accountId: "CR123456",
          fetchImpl: (async () => {
            fetchCalled = true;
            throw new Error("must not run");
          }) as typeof fetch,
        }),
      ),
    /Only Deriv virtual trading accounts are enabled/,
  );
  assert.equal(fetchCalled, false);
});

test("rejects DIGITUNDER with barrier 0 before any broker request", () => {
  const base = {
    underlyingSymbol: "R_100",
    contractType: "DIGITUNDER",
    currency: "USD",
    stake: 1,
    duration: 1,
    durationUnit: "t" as const,
  };
  // Under 0 means "last digit < 0", which is impossible; the proposal must
  // never reach the broker.
  assert.throws(
    () => buildOptionsProposal({ ...base, barrier: "0" }),
    /Digit Under barrier must be between 1 and 8/,
  );
});

test("rejects DIGITOVER with barrier 9 before any broker request", () => {
  const base = {
    underlyingSymbol: "R_100",
    contractType: "DIGITOVER",
    currency: "USD",
    stake: 1,
    duration: 1,
    durationUnit: "t" as const,
  };
  // Over 9 means "last digit > 9", which is impossible.
  assert.throws(
    () => buildOptionsProposal({ ...base, barrier: "9" }),
    /Digit Over barrier must be between 1 and 8/,
  );
});

test("accepts DIGITUNDER barrier 1 and DIGITOVER barrier 8", () => {
  const under = buildOptionsProposal({
    underlyingSymbol: "R_100",
    contractType: "DIGITUNDER",
    currency: "USD",
    stake: 1,
    duration: 1,
    durationUnit: "t",
    barrier: "1",
  });
  assert.equal(under.contract_type, "DIGITUNDER");
  assert.equal(under.barrier, "1");

  const over = buildOptionsProposal({
    underlyingSymbol: "R_100",
    contractType: "DIGITOVER",
    currency: "USD",
    stake: 1,
    duration: 1,
    durationUnit: "t",
    barrier: "8",
  });
  assert.equal(over.contract_type, "DIGITOVER");
  assert.equal(over.barrier, "8");
});

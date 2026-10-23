import test from "node:test";
import assert from "node:assert/strict";
import { latestEventTime, newRobotOrders } from "./robot-signals.js";
import type { AuditEvent } from "./sim.js";

const ev = (time: number, type: AuditEvent["type"], message: string): AuditEvent => ({ time, type, message });

test("only fills after the arming time become orders; direction maps to CALL/PUT", () => {
  const events = [ev(100, "FILLED", "PAPER LONG 1 @ 5"), ev(200, "EXIT", "LONG closed"), ev(300, "FILLED", "PAPER SHORT 2 @ 6"), ev(400, "SIGNAL", "LONG signal")];
  const orders = newRobotOrders(events, 100, 7, "R_100");
  assert.deepEqual(orders.map(o => [o.time, o.contractType]), [[300, "PUT"]]);
});

test("still finds new fills after the audit log is trimmed (position-based tracking would miss them)", () => {
  const old = Array.from({ length: 500 }, (_, i) => ev(i + 1, "INFO", "x"));
  const events = [...old.slice(1), ev(600, "FILLED", "PAPER LONG 1 @ 5")]; // still 500 long after trimming
  assert.equal(events.length, 500);
  assert.equal(newRobotOrders(events, 500, 7, "R_100").length, 1);
});

test("idempotency keys are deterministic, safe characters and 16-100 long", () => {
  const a = newRobotOrders([ev(300, "FILLED", "PAPER LONG 1 @ 5")], 0, 1700000000000, "frxEURUSD");
  const b = newRobotOrders([ev(300, "FILLED", "PAPER LONG 1 @ 5")], 0, 1700000000000, "frxEURUSD");
  assert.equal(a[0].idempotencyKey, b[0].idempotencyKey);
  assert.match(a[0].idempotencyKey, /^[A-Za-z0-9_-]{16,100}$/);
});

test("duplicate events for one candle produce one order; unknown messages are ignored", () => {
  const events = [ev(300, "FILLED", "PAPER LONG 1 @ 5"), ev(300, "FILLED", "PAPER LONG 1 @ 5"), ev(310, "FILLED", "something else")];
  assert.equal(newRobotOrders(events, 0, 1, "R_100").length, 1);
});

test("latestEventTime", () => {
  assert.equal(latestEventTime([]), 0);
  assert.equal(latestEventTime([ev(5, "INFO", ""), ev(9, "INFO", "")]), 9);
});

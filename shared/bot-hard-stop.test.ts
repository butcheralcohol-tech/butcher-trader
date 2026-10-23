import test from "node:test";
import assert from "node:assert/strict";
import { BotHardStopGuard } from "./bot-hard-stop.js";

test("stops new orders after the configured one-order run limit", () => {
  const guard = new BotHardStopGuard({ maxRunLoss: 5, maxOrdersPerRun: 1 });
  assert.equal(guard.canPlaceOrder(), true);
  guard.record({ type: "order_accepted" });
  assert.equal(guard.canPlaceOrder(), false);
  assert.equal(guard.snapshot().ordersPlaced, 1);
  assert.equal(guard.snapshot().stopped, false); // accepted trade may still settle
});

test("hard-stops when cumulative broker settlement losses hit the ceiling", () => {
  const guard = new BotHardStopGuard({ maxRunLoss: 5, maxOrdersPerRun: 10 });
  guard.record({ type: "trade_settled", profit: -2.5 });
  const result = guard.record({ type: "trade_settled", profit: -2.5 });
  assert.equal(result.stopped, true);
  assert.equal(result.cumulativeSettledPnl, -5);
  assert.equal(guard.canPlaceOrder(), false);
});

test("does not stop for losses below the ceiling", () => {
  const guard = new BotHardStopGuard({ maxRunLoss: 5, maxOrdersPerRun: 10 });
  assert.equal(guard.record({ type: "trade_settled", profit: -4.99 }).stopped, false);
});

test("fails closed on invalid settlement P&L", () => {
  const guard = new BotHardStopGuard({ maxRunLoss: 5, maxOrdersPerRun: 10 });
  assert.equal(guard.record({ type: "trade_settled", profit: Number.NaN }).stopped, true);
});

test("broker reconciliation can trigger the stop independently", () => {
  const guard = new BotHardStopGuard({ maxRunLoss: 5, maxOrdersPerRun: 10 });
  assert.equal(guard.record({ type: "broker_reconciliation", cumulativePnl: -6 }).stopped, true);
});

test("rejects unsafe configuration", () => {
  assert.throws(() => new BotHardStopGuard({ maxRunLoss: 0, maxOrdersPerRun: 1 }));
  assert.throws(() => new BotHardStopGuard({ maxRunLoss: 5, maxOrdersPerRun: 0 }));
});

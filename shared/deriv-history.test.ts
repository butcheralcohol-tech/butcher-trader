import test from "node:test";
import assert from "node:assert/strict";
import { transactionMarket, transactionPnl, transactionTime, validateRiskHistory } from "./deriv-history.js";

test("reads current Deriv underlying_symbol and purchase_time fields", () => {
  const transaction = {
    underlying_symbol: "R_100",
    purchase_time: 1792576590,
    buy_price: 10,
    sell_price: 16.5,
  };
  assert.equal(transactionMarket(transaction), "R_100");
  assert.equal(transactionTime(transaction), 1792576590);
  assert.equal(transactionPnl(transaction), 6.5);
  assert.deepEqual(validateRiskHistory([transaction]), []);
});

test("prefers broker-reported profit and sell timestamp", () => {
  assert.equal(transactionPnl({ profit: -2.5, buy_price: 10, sell_price: 20 }), -2.5);
  assert.equal(transactionTime({ sell_time: 1792576600, purchase_time: 1792576500 }), 1792576600);
});

test("supports legacy market fields and known shortcode symbols", () => {
  assert.equal(transactionMarket({ symbol: "frxEURUSD" }), "frxEURUSD");
  assert.equal(transactionMarket({ shortcode: "CALL_R_100_5.00_10" }), "R_100");
});

test("fails closed for incomplete records and capped history", () => {
  assert.equal(validateRiskHistory([{ underlying_symbol: "R_100" }]).length, 1);
  assert.ok(validateRiskHistory(Array.from({ length: 500 }, () => ({
    underlying_symbol: "R_100", purchase_time: 1792576590, buy_price: 1, sell_price: 2,
  }))).some((reason) => reason.includes("500-record")));
});

export type BrokerTransaction = Record<string, unknown>;

export function numberField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** Normalize both the legacy and current Deriv profit_table field names. */
export function transactionPnl(transaction: BrokerTransaction): number | null {
  const direct = numberField(transaction.profit);
  if (direct !== null) return direct;

  const sell = numberField(transaction.sell_price);
  const buy = numberField(transaction.buy_price);
  if (sell === null || buy === null) return null;

  return Math.round((sell - buy) * 1e8) / 1e8;
}

export function transactionTime(transaction: BrokerTransaction): number | null {
  for (const field of ["sell_time", "transaction_time", "purchase_time", "date_settlement", "date_expiry"]) {
    const value = numberField(transaction[field]);
    if (value !== null && value > 0) return value;
  }
  return null;
}

export function transactionMarket(transaction: BrokerTransaction): string {
  for (const field of ["underlying_symbol", "underlying", "symbol", "display_name"]) {
    const value = transaction[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  // Some legacy responses omit the symbol field but include Deriv's contract shortcode.
  const shortcode = transaction.shortcode;
  if (typeof shortcode === "string") {
    const match = shortcode.match(/(?:^|_)(R_[0-9]+|1HZ[0-9]+V|JD[0-9]+|frx[A-Z]{6})(?:_|$)/i);
    if (match) return match[1];
  }
  return "";
}

export function validateRiskHistory(transactions: BrokerTransaction[]): string[] {
  const reasons: string[] = [];
  if (transactions.length >= 500) {
    reasons.push("Broker history reached the 500-record query limit; risk totals may be incomplete.");
  }
  const invalid = transactions.filter((transaction) =>
    transactionTime(transaction) === null ||
    transactionPnl(transaction) === null ||
    transactionMarket(transaction) === ""
  );
  if (invalid.length > 0) {
    reasons.push(`Broker history contains ${invalid.length} transaction(s) without a usable timestamp, P&L, or market identifier.`);
  }
  return reasons;
}

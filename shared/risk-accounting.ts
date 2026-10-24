/** Broker-history risk accounting. Accepts both legacy and new Deriv profit_table row shapes and fails closed on anything unreadable. */

export interface ClosedTrade { sellTime: number; profit: number; symbol: string }
export interface RiskTotals { dailyNetPnl: number; marketNetPnl: number; sessionNetPnl: number; closedToday: number }

export const HISTORY_ROW_LIMIT = 500;

export function numberField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function epochField(value: unknown): number | null {
  const n = numberField(value);
  if (n !== null) return n > 1e12 ? Math.floor(n / 1000) : n;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  return null;
}

const SHORTCODE_SYMBOL = /^[A-Z]+_((?:1HZ\d+V|R_\d+|JD\d+|CRASH\d+N?|BOOM\d+N?|RDBEAR|RDBULL|stpRNG\d*|[A-Za-z0-9]+_[A-Za-z0-9]+))_/;

export function normalizeTrade(row: Record<string, unknown>): ClosedTrade | null {
  const buy = numberField(row.buy_price), sell = numberField(row.sell_price);
  const profit = numberField(row.profit) ?? (buy !== null && sell !== null ? sell - buy : null);
  const direct = row.underlying ?? row.underlying_symbol ?? row.symbol;
  const symbol = typeof direct === "string" && direct
    ? direct
    : typeof row.shortcode === "string" ? SHORTCODE_SYMBOL.exec(row.shortcode)?.[1] ?? null : null;
  const sellTime = epochField(row.sell_time ?? row.close_time);
  return profit === null || symbol === null || sellTime === null ? null : { sellTime, profit, symbol };
}

export function utcDayStart(nowMs: number): number {
  const d = new Date(nowMs);
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** Throws (fail closed) when history is missing, truncated or unreadable. */
export function computeRiskTotals(transactions: unknown, symbol: string, nowMs = Date.now(), sessionHours = 4): RiskTotals {
  if (!Array.isArray(transactions)) throw new Error("Broker profit history is unavailable; fail closed.");
  if (transactions.length >= HISTORY_ROW_LIMIT) {
    throw new Error("Broker history reached the query limit; risk totals may be incomplete, so orders are disabled.");
  }
  const trades: ClosedTrade[] = [];
  for (const row of transactions) {
    const t = row && typeof row === "object" ? normalizeTrade(row as Record<string, unknown>) : null;
    if (!t) throw new Error("Broker history is missing timestamps, P&L, or market identifiers; risk accounting is incomplete, so orders are disabled.");
    trades.push(t);
  }
  const today = utcDayStart(nowMs);
  const sessionStart = Math.floor(nowMs / 1000) - sessionHours * 3600;
  const sum = (f: (t: ClosedTrade) => boolean) => trades.filter(f).reduce((s, t) => s + t.profit, 0);
  return {
    dailyNetPnl: sum((t) => t.sellTime >= today),
    marketNetPnl: sum((t) => t.symbol === symbol && t.sellTime >= today),
    sessionNetPnl: sum((t) => t.sellTime >= sessionStart),
    closedToday: trades.filter((t) => t.sellTime >= today).length,
  };
}

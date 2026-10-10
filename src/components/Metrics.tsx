import type { Metrics } from "../../shared/backtest.js";
import { money, pct, signedMoney } from "../lib/format";

export default function MetricsGrid({ title, m, note }: { title: string; m: Metrics; note?: string }) {
  const cell = (label: string, value: string, tone = "") => <div className={`metric ${tone}`}><small>{label}</small><b>{value}</b></div>;
  return <div className="metrics-card"><div className="metrics-head"><b>{title}</b>{note && <span>{note}</span>}</div>
    <div className="metrics-grid">
      {cell("TRADES", String(m.trades))}
      {cell("WIN RATE", m.trades ? pct(m.winRate, 1) : "—")}
      {cell("NET P&L", signedMoney(m.netPnl), m.netPnl > 0 ? "up" : m.netPnl < 0 ? "down" : "")}
      {cell("RETURN", pct(m.returnPct), m.returnPct > 0 ? "up" : m.returnPct < 0 ? "down" : "")}
      {cell("PROFIT FACTOR", m.profitFactor === null ? (m.wins ? "∞" : "—") : m.profitFactor.toFixed(2))}
      {cell("EXPECTANCY", m.trades ? `${m.expectancyR.toFixed(2)} R` : "—", m.expectancyR > 0 ? "up" : m.expectancyR < 0 ? "down" : "")}
      {cell("MAX DRAWDOWN", pct(m.maxDrawdownPct), m.maxDrawdownPct > 10 ? "down" : "")}
      {cell("LOSING STREAK", String(m.maxConsecLosses))}
      {cell("FEES PAID", money(m.feesPaid))}
    </div></div>;
}

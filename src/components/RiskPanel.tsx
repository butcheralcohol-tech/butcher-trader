import { useEffect, useState } from "react";
import { LockKeyhole, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { fmt } from "../lib/format";

type RiskResult = { allowed: boolean; reasons: string[]; maxRiskAmount: number };

export default function RiskPanel() {
  const [risk, setRisk] = useState({ balance: "1000", riskPercent: "0.5", dailyLossLimitPercent: "2", dailyPnl: "0" });
  const [result, setResult] = useState<RiskResult | null>(null);
  const [apiHealth, setApiHealth] = useState("CHECKING");
  useEffect(() => { fetch("/api/health").then(r => r.json()).then(() => setApiHealth("ONLINE")).catch(() => setApiHealth("OFFLINE")); }, []);

  async function check() {
    try {
      const response = await fetch("/api/risk/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ balance: Number(risk.balance), riskPercent: Number(risk.riskPercent), dailyLossLimitPercent: Number(risk.dailyLossLimitPercent), dailyPnl: Number(risk.dailyPnl), openPositions: 0, maxOpenPositions: 1, liveEnabled: false }) });
      setResult(await response.json());
    } catch { setResult({ allowed: false, reasons: ["Risk API unavailable. Fail-closed: no trade."], maxRiskAmount: 0 }); }
  }
  const field = (label: string, key: keyof typeof risk, extra: { min?: number; max?: number; step?: number } = {}) =>
    <label>{label}<input type="number" value={risk[key]} onChange={e => setRisk({ ...risk, [key]: e.target.value })} {...extra} /></label>;

  return <section className="risk-grid">
    <div className="risk-card"><div className="card-title"><ShieldCheck size={18} /><b>Pre-trade risk gate</b><span className="card-status">ACTIVE</span></div>
      <p>Set demo account assumptions. The backend validates limits before any strategy can request a trade. The same gate is applied inside the backtester and the paper trader.</p>
      <div className="fields">{field("Demo balance (USD)", "balance", { min: 1 })}{field("Risk per trade (%)", "riskPercent", { min: 0.1, max: 1, step: 0.1 })}{field("Daily loss lock (%)", "dailyLossLimitPercent", { min: 0.1, max: 3, step: 0.1 })}{field("Demo daily P&L ($)", "dailyPnl", { max: 0 })}</div>
      <button className="primary-btn" onClick={check}><RefreshCw size={15} /> Run risk check</button>
      {result && <div className={`risk-result ${result.allowed ? "pass" : "blocked"}`}><b>{result.allowed ? "GATE PASSED — DEMO ONLY" : "TRADE BLOCKED"}</b><span>Max planned risk: ${fmt(result.maxRiskAmount)}</span>{result.reasons.map(r => <small key={r}>{r}</small>)}</div>}</div>
    <div className="stats-column">
      <div className="stat-card"><div className="stat-icon"><Zap size={17} /></div><div><small>EXECUTION MODE</small><b>DEMO ONLY</b><span>Live execution not implemented</span></div><div className="stat-lock"><LockKeyhole size={16} /></div></div>
      <div className="stat-card"><div className="stat-icon"><ShieldCheck size={17} /></div><div><small>BACKEND STATUS</small><b>{apiHealth}</b><span>Serverless API · Vercel</span></div><div className={`status-led ${apiHealth === "ONLINE" ? "" : "off"}`} /></div>
      <div className="warning-note"><b>Risk notice</b><p>Derivatives and synthetic indices are high risk. A passing gate is not a trade recommendation and does not predict outcomes. Test strategies on demo data before considering live use.</p></div></div>
  </section>;
}

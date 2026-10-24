import { useEffect, useState } from "react";
import { LockKeyhole, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { TRADING_POLICY } from "../../shared/trading-config.js";
import { fmt } from "../lib/format";

type RiskResult = { allowed: boolean; reasons: string[]; maxRiskAmount: number };

export default function RiskPanel() {
  const [risk, setRisk] = useState({
    balance: String(TRADING_POLICY.startingBalanceUsd),
    riskPercent: String(TRADING_POLICY.riskPercent),
    dailyLossLimitPercent: String(TRADING_POLICY.dailyLossLimitPercent),
    dailyPnl: "0",
  });
  const [result, setResult] = useState<RiskResult | null>(null);
  const [apiHealth, setApiHealth] = useState("CHECKING");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(() => setApiHealth("ONLINE"))
      .catch(() => setApiHealth("OFFLINE"));
  }, []);

  async function check() {
    try {
      const response = await fetch("/api/risk/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          balance: Number(risk.balance),
          riskPercent: Number(risk.riskPercent),
          dailyLossLimitPercent: Number(risk.dailyLossLimitPercent),
          dailyPnl: Number(risk.dailyPnl),
          openPositions: 0,
          maxOpenPositions: TRADING_POLICY.maxOpenPositions,
          liveEnabled: false,
        }),
      });
      setResult(await response.json());
    } catch {
      setResult({
        allowed: false,
        reasons: ["Risk API unavailable. Fail-closed: no trade."],
        maxRiskAmount: 0,
      });
    }
  }

  const field = (
    label: string,
    key: keyof typeof risk,
    extra: { min?: number; max?: number; step?: number } = {},
  ) => (
    <label>
      {label}
      <input
        type="number"
        value={risk[key]}
        onChange={(e) => setRisk({ ...risk, [key]: e.target.value })}
        {...extra}
      />
    </label>
  );

  return (
    <section className="risk-grid">
      <div className="risk-card">
        <div className="card-title">
          <ShieldCheck size={18} />
          <b>Pre-trade risk gate</b>
          <span className="card-status">DEMO POLICY</span>
        </div>
        <p>
          Demo settings: $1,000 starting balance, 1% maximum planned risk ($10 initially) per
          trade, $20 absolute daily loss lock, and $40 aspirational daily profit target. The target
          is not guaranteed. This screen checks a demo simulation; it does not place broker orders.
        </p>
        <div className="fields">
          {field("Demo balance (USD)", "balance", { min: 1 })}
          {field("Risk per trade (%)", "riskPercent", {
            min: 0.1,
            max: TRADING_POLICY.riskPercent,
            step: 0.1,
          })}
          {field("Daily loss lock (%)", "dailyLossLimitPercent", {
            min: 0.1,
            max: TRADING_POLICY.dailyLossLimitPercent,
            step: 0.1,
          })}
          {field("Demo daily P&L ($)", "dailyPnl")}
        </div>
        <button className="primary-btn" onClick={check}>
          <RefreshCw size={15} /> Run risk check
        </button>
        {result && (
          <div className={`risk-result ${result.allowed ? "pass" : "blocked"}`}>
            <b>{result.allowed ? "GATE PASSED — DEMO ONLY" : "TRADE BLOCKED"}</b>
            <span>Max planned risk: ${fmt(result.maxRiskAmount)}</span>
            {result.reasons.map((r) => (
              <small key={r}>{r}</small>
            ))}
          </div>
        )}
      </div>
      <div className="stats-column">
        <div className="stat-card">
          <div className="stat-icon">
            <Zap size={17} />
          </div>
          <div>
            <small>EXECUTION MODE</small>
            <b>DEMO ONLY · LIVE LOCKED</b>
            <span>Broker orders disabled</span>
          </div>
          <div className="stat-lock">
            <LockKeyhole size={16} />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">
            <ShieldCheck size={17} />
          </div>
          <div>
            <small>MARKETS</small>
            <b>SYNTHETIC + FOREX</b>
            <span>One open position maximum</span>
          </div>
          <div className="stat-lock">
            <LockKeyhole size={16} />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">
            <ShieldCheck size={17} />
          </div>
          <div>
            <small>STRATEGY METHOD</small>
            <b>WEIGHTED · CONFIGURED</b>
            <span>Weighted paper strategy engine</span>
          </div>
          <div className={`status-led ${apiHealth === "ONLINE" ? "" : "off"}`} />
        </div>
        <div className="stat-card">
          <div className="stat-icon">
            <ShieldCheck size={17} />
          </div>
          <div>
            <small>BACKEND STATUS</small>
            <b>{apiHealth}</b>
            <span>Serverless API · Vercel</span>
          </div>
          <div className={`status-led ${apiHealth === "ONLINE" ? "" : "off"}`} />
        </div>
        <div className="warning-note">
          <b>Server-side risk boundary</b>
          <p>
            The API fixes the configured dollar/percentage limits, but it does not yet read
            authoritative broker balance/P&L or gate a broker order because authenticated order
            execution is not implemented. Daily stops currently prevent new simulated entries; they
            cannot guarantee exit prices or prevent slippage.
          </p>
        </div>
      </div>
    </section>
  );
}

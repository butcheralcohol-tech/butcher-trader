import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, ShieldCheck, Radio, Crosshair, LockKeyhole, RefreshCw, Zap } from "lucide-react";

type Tick = { quote: number; epoch: number; symbol: string };
const markets = [
  { symbol: "R_100", name: "Volatility 100 Index", group: "SYNTHETIC" },
  { symbol: "R_75", name: "Volatility 75 Index", group: "SYNTHETIC" },
  { symbol: "frxEURUSD", name: "EUR / USD", group: "FOREX" },
  { symbol: "frxGBPUSD", name: "GBP / USD", group: "FOREX" },
];
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export default function App() {
  const [selected, setSelected] = useState("R_100");
  const [tick, setTick] = useState<Tick | null>(null);
  const [status, setStatus] = useState("CONNECTING");
  const [risk, setRisk] = useState({ balance: "1000", riskPercent: "0.5", dailyLossLimitPercent: "2" });
  const [riskResult, setRiskResult] = useState<{ allowed: boolean; reasons: string[]; maxRiskAmount: number } | null>(null);
  const [apiHealth, setApiHealth] = useState("CHECKING");
  const [history, setHistory] = useState<number[]>([]);
  const market = markets.find(m => m.symbol === selected)!;
  const change = useMemo(() => history.length > 1 ? ((history.at(-1)! - history[0]) / history[0]) * 100 : 0, [history]);

  useEffect(() => { fetch("/api/health").then(r => r.json()).then(() => setApiHealth("ONLINE")).catch(() => setApiHealth("OFFLINE")); }, []);
  useEffect(() => {
    setTick(null); setHistory([]); setStatus("CONNECTING");
    const appId = import.meta.env.VITE_DERIV_APP_ID || "1089";
    const socket = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`);
    socket.onopen = () => { setStatus("LIVE FEED"); socket.send(JSON.stringify({ ticks: selected, subscribe: 1 })); };
    socket.onmessage = event => {
      try { const msg = JSON.parse(event.data); if (msg.tick) { const next = Number(msg.tick.quote); setTick({ quote: next, epoch: Number(msg.tick.epoch), symbol: selected }); setHistory(prev => [...prev, next].slice(-30)); } if (msg.error) setStatus("FEED ERROR"); } catch { setStatus("FEED ERROR"); }
    };
    socket.onerror = () => setStatus("RECONNECT NEEDED");
    socket.onclose = () => setStatus(prev => prev === "LIVE FEED" ? "DISCONNECTED" : prev);
    return () => socket.close();
  }, [selected]);

  async function checkRisk() {
    try {
      const response = await fetch("/api/risk/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ balance: Number(risk.balance), riskPercent: Number(risk.riskPercent), dailyLossLimitPercent: Number(risk.dailyLossLimitPercent), dailyPnl: 0, openPositions: 0, maxOpenPositions: 1, liveEnabled: false }) });
      setRiskResult(await response.json());
    } catch { setRiskResult({ allowed: false, reasons: ["Risk API unavailable. Fail-closed: no trade."], maxRiskAmount: 0 }); }
  }

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">B<span>×</span></div><div><b>BUTCHER</b><small>TRADER / SYSTEM 01</small></div></div>
      <div className="side-label">WORKSPACE</div><div className="nav-item active"><Activity size={17}/> Overview <span className="nav-dot"/></div><div className="nav-item"><Crosshair size={17}/> Strategy lab <span className="soon">SOON</span></div><div className="nav-item"><ShieldCheck size={17}/> Risk controls</div>
      <div className="side-bottom"><div className="status-led"/><div><b>DEMO PROTOCOL</b><small>LIVE ORDERS DISABLED</small></div></div></aside>
    <main className="main"><header className="topbar"><div><div className="eyebrow">TRADING INTELLIGENCE / OVERVIEW</div><h1>Control room<span>.</span></h1></div><div className="top-actions"><span className="demo-badge"><span/> DEMO MODE</span><div className="avatar">BT</div></div></header>
      <section className="hero"><div className="hero-grid"/><div className="hero-copy"><div className="eyebrow red">DISCIPLINE OVER IMPULSE</div><h2>Stay sharp.<br/><em>Protect capital.</em></h2><p>A demo-first trading workspace. Signals are observations, not guarantees. Every order must pass the risk gate.</p><div className="hero-tags"><span><LockKeyhole size={13}/> LIVE EXECUTION LOCKED</span><span><ShieldCheck size={13}/> RISK GATE ACTIVE</span></div></div><div className="hero-emblem"><div className="emblem-ring"><span>B</span></div><div className="emblem-caption">PRECISION / PATIENCE / PROCESS</div></div></section>
      <div className="section-heading"><div><div className="eyebrow">01 / MARKET INTELLIGENCE</div><h3>Market watch</h3></div><div className="feed-status"><span className={status === "LIVE FEED" ? "pulse" : "pulse muted"}/>{status}</div></div>
      <section className="market-layout"><div className="market-list">{markets.map(m => <button key={m.symbol} onClick={() => setSelected(m.symbol)} className={`market-row ${selected === m.symbol ? "chosen" : ""}`}><div className="market-icon">{m.group === "FOREX" ? "FX" : "V"}</div><div className="market-name"><b>{m.name}</b><small>{m.symbol} · {m.group}</small></div><div className="market-arrow">{selected === m.symbol ? <ArrowUpRight size={16}/> : <ArrowDownRight size={16}/>}</div></button>)}</div>
        <div className="price-panel"><div className="price-top"><div><span className="tiny-label">SELECTED INSTRUMENT</span><h4>{market.name}</h4><small>{market.symbol}</small></div><span className="live-chip"><Radio size={12}/> STREAM</span></div><div className="price-value">{tick ? fmt(tick.quote) : "— — —"}</div><div className={`price-change ${change >= 0 ? "up" : "down"}`}>{change >= 0 ? <ArrowUpRight size={16}/> : <ArrowDownRight size={16}/>} {history.length > 1 ? `${Math.abs(change).toFixed(3)}%` : "Collecting ticks"} <span>· recent feed movement</span></div><div className="chart">{history.length > 1 ? <svg viewBox="0 0 600 115" preserveAspectRatio="none" aria-label="Recent price movement"><polyline points={history.map((v, i) => `${i * (600 / (history.length - 1))},${100 - ((v - Math.min(...history)) / (Math.max(...history) - Math.min(...history) || 1)) * 80}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/></svg> : <div className="chart-empty"><Activity size={20}/> Waiting for market ticks</div>}</div><div className="chart-footer"><span>LIVE QUOTE <b>{tick ? new Date(tick.epoch * 1000).toLocaleTimeString() : "Waiting…"}</b></span><span>NO ORDERS PLACED</span></div></div></section>
      <div className="section-heading lower"><div><div className="eyebrow">02 / CAPITAL PRESERVATION</div><h3>Risk engine</h3></div><span className="safe-label"><ShieldCheck size={14}/> CONSERVATIVE PRESET</span></div>
      <section className="risk-grid"><div className="risk-card"><div className="card-title"><ShieldCheck size={18}/><b>Pre-trade risk gate</b><span className="card-status">ACTIVE</span></div><p>Set demo account assumptions. The backend validates limits before any future strategy can request a trade.</p><div className="fields"><label>Demo balance (USD)<input type="number" min="1" value={risk.balance} onChange={e => setRisk({...risk, balance:e.target.value})}/></label><label>Risk per trade (%)<input type="number" min="0.1" max="1" step="0.1" value={risk.riskPercent} onChange={e => setRisk({...risk, riskPercent:e.target.value})}/></label><label>Daily loss lock (%)<input type="number" min="0.1" max="3" step="0.1" value={risk.dailyLossLimitPercent} onChange={e => setRisk({...risk, dailyLossLimitPercent:e.target.value})}/></label></div><button className="primary-btn" onClick={checkRisk}><RefreshCw size={15}/> Run risk check</button>{riskResult && <div className={`risk-result ${riskResult.allowed ? "pass" : "blocked"}`}><b>{riskResult.allowed ? "GATE PASSED — DEMO ONLY" : "TRADE BLOCKED"}</b><span>Max planned risk: ${fmt(riskResult.maxRiskAmount)}</span>{riskResult.reasons.map(r => <small key={r}>{r}</small>)}</div>}</div>
        <div className="stats-column"><div className="stat-card"><div className="stat-icon"><Zap size={17}/></div><div><small>EXECUTION MODE</small><b>DEMO ONLY</b><span>Live execution not implemented</span></div><div className="stat-lock"><LockKeyhole size={16}/></div></div><div className="stat-card"><div className="stat-icon"><ShieldCheck size={17}/></div><div><small>BACKEND STATUS</small><b>{apiHealth}</b><span>Risk service · localhost:8787</span></div><div className={`status-led ${apiHealth === "ONLINE" ? "" : "off"}`}/></div><div className="warning-note"><b>Risk notice</b><p>Derivatives and synthetic indices are high risk. A passing gate is not a trade recommendation and does not predict outcomes. Test strategies on demo data before considering live use.</p></div></div></section>
      <footer><span>BUTCHER TRADER <b>·</b> BUILD 0.1.0</span><span>STAY DISCIPLINED. NO GUARANTEED RETURNS.</span></footer>
    </main>
  </div>;
}

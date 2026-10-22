import { useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, Crosshair, FileText, KeyRound, LockKeyhole, Radio, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { ema } from "../shared/indicators.js";
import { GRANULARITIES } from "../shared/candles.js";
import CandleChart, { type Marker } from "./components/CandleChart";
import PaperTrading from "./components/PaperTrading";
import ManualTrading from "./components/ManualTrading";
import DerivConnection from "./components/DerivConnection";
import RiskPanel from "./components/RiskPanel";
import StrategyLab from "./components/StrategyLab";
import { usePaper } from "./hooks/usePaper";
import { useLiveFeed } from "./hooks/useLiveFeed";
import { clockSeconds, fmt } from "./lib/format";
import { MARKETS } from "./lib/markets";

type View = "overview" | "lab" | "paper" | "manual" | "account" | "risk";
const titles: Record<View, string> = { overview: "Control room", lab: "Strategy lab", paper: "Paper trading", manual: "Manual desk", account: "Deriv connection", risk: "Risk controls" };

export default function App() {
  const [view, setView] = useState<View>(() => new URLSearchParams(window.location.search).get("view") === "account" ? "account" : "overview");
  const paper = usePaper();
  const nav = (id: View, label: string, icon: JSX.Element, badge?: string) =>
    <button key={id} className={`nav-item ${view === id ? "active" : ""}`} onClick={() => setView(id)}>{icon} {label}{badge ? <span className="soon">{badge}</span> : view === id ? <span className="nav-dot" /> : null}</button>;

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">B<span>×</span></div><div><b>BUTCHER</b><small>TRADER / SYSTEM 02</small></div></div>
      <div className="side-label">WORKSPACE</div>
      {nav("overview", "Overview", <Activity size={17} />)}
      {nav("lab", "Strategy lab", <Crosshair size={17} />)}
      {nav("paper", "Paper trading", <FileText size={17} />, paper.session ? "RUN" : undefined)}
      {nav("manual", "Manual desk", <SlidersHorizontal size={17} />)}
      {nav("account", "Deriv connection", <KeyRound size={17} />)}
      {nav("risk", "Risk controls", <ShieldCheck size={17} />)}
      <div className="side-bottom"><div className="status-led" /><div><b>DEMO PROTOCOL</b><small>LIVE ORDERS DISABLED</small></div></div></aside>
    <main className="main"><header className="topbar"><div><div className="eyebrow">TRADING INTELLIGENCE / {view.toUpperCase()}</div><h1>{titles[view]}<span>.</span></h1></div><div className="top-actions"><span className="demo-badge"><span /> DEMO MODE</span><div className="avatar">BT</div></div></header>
      <nav className="mobile-nav" aria-label="Sections">{(Object.keys(titles) as View[]).map(id => <button key={id} className={view === id ? "on" : ""} onClick={() => setView(id)}>{titles[id]}</button>)}</nav>
      {view === "overview" && <Overview /> }
      {view === "lab" && <StrategyLab />}
      {view === "paper" && <PaperTrading paper={paper} />}
      {view === "manual" && <ManualTrading />}
      {view === "account" && <DerivConnection />}
      {view === "risk" && <><div className="section-heading"><div><div className="eyebrow">02 / CAPITAL PRESERVATION</div><h3>Risk engine</h3></div><span className="safe-label"><ShieldCheck size={14} /> CONSERVATIVE PRESET</span></div><RiskPanel /></>}
      <footer><span>BUTCHER TRADER <b>·</b> BUILD 0.2.0</span><span>STAY DISCIPLINED. NO GUARANTEED RETURNS.</span></footer>
    </main>
  </div>;
}

function Overview() {
  const [selected, setSelected] = useState<string>("R_100");
  const [granularity, setGranularity] = useState(60);
  const { candles, info } = useLiveFeed(selected, granularity, 300);
  const market = MARKETS.find(m => m.symbol === selected)!;
  const last = candles[candles.length - 1];
  const change = candles.length > 1 ? ((last.close - candles[0].open) / candles[0].open) * 100 : 0;
  const overlays = useMemo(() => {
    const closes = candles.map(c => c.close);
    return [{ label: "EMA 9", color: "#e5a344", values: ema(closes, 9) }, { label: "EMA 21", color: "#6aa7ff", values: ema(closes, 21) }];
  }, [candles]);
  const markers: Marker[] = [];
  const live = info.status === "LIVE";

  return <>
    <section className="hero"><div className="hero-grid" /><div className="hero-copy"><div className="eyebrow red">DISCIPLINE OVER IMPULSE</div><h2>Stay sharp.<br /><em>Protect capital.</em></h2><p>A demo-first trading workspace. Signals are observations, not guarantees. Every order must pass the risk gate.</p><div className="hero-tags"><span><LockKeyhole size={13} /> LIVE EXECUTION LOCKED</span><span><ShieldCheck size={13} /> RISK GATE ACTIVE</span></div></div><div className="hero-emblem"><div className="emblem-ring"><span>B</span></div><div className="emblem-caption">PRECISION / PATIENCE / PROCESS</div></div></section>
    <section className="dashboard-stats" aria-label="Dashboard summary"><article className="dashboard-stat"><span className="dashboard-stat-icon"><Activity size={16} /></span><div><small>SELECTED MARKET</small><strong>{market.symbol}</strong><span>{market.name}</span></div></article><article className="dashboard-stat"><span className="dashboard-stat-icon"><Radio size={16} /></span><div><small>FEED STATUS</small><strong className={live ? "metric-good" : "metric-wait"}>{info.status}</strong><span>{info.lastDataAt ? `Updated ${clockSeconds(info.lastDataAt)}` : "Waiting for market data"}</span></div></article><article className="dashboard-stat"><span className="dashboard-stat-icon"><Crosshair size={16} /></span><div><small>CANDLES LOADED</small><strong>{candles.length}</strong><span>{GRANULARITIES.find(g => g.seconds === granularity)?.label ?? "Selected timeframe"}</span></div></article><article className="dashboard-stat"><span className="dashboard-stat-icon"><LockKeyhole size={16} /></span><div><small>EXECUTION MODE</small><strong>DEMO ONLY</strong><span>Live orders disabled</span></div></article></section>\n    <div className="section-heading"><div><div className="eyebrow">QUICK EXECUTION</div><h3>Place a trade from the dashboard</h3></div><span className="safe-label"><ShieldCheck size={14} /> VIRTUAL ONLY</span></div>\n    <p className="hint">Use the quick trade desk below to open or close a simulated LONG/SHORT position from this dashboard. These controls do not place orders on Deriv.</p>\n    <ManualTrading />\n    <div className="section-heading"><div><div className="eyebrow">01 / MARKET INTELLIGENCE</div><h3>Market watch</h3></div><div className="feed-status"><span className={live ? "pulse" : "pulse muted"} />{info.status}{info.lastDataAt ? ` · updated ${clockSeconds(info.lastDataAt)}` : ""}</div></div>
    <section className="market-layout"><div className="market-list">{MARKETS.map(m => <button key={m.symbol} onClick={() => setSelected(m.symbol)} className={`market-row ${selected === m.symbol ? "chosen" : ""}`}><div className="market-icon">{m.group === "FOREX" ? "FX" : "V"}</div><div className="market-name"><b>{m.name}</b><small>{m.symbol} · {m.group}</small></div><div className="market-arrow">{selected === m.symbol ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}</div></button>)}</div>
      <div className="price-panel"><div className="price-top"><div><span className="tiny-label">SELECTED INSTRUMENT</span><h4>{market.name}</h4><small>{market.symbol}</small></div>
        <div className="tf-switch" role="group" aria-label="Timeframe">{GRANULARITIES.map(g => <button key={g.seconds} className={granularity === g.seconds ? "on" : ""} onClick={() => setGranularity(g.seconds)}>{g.label}</button>)}</div>
        <span className="live-chip"><Radio size={12} /> {live ? "STREAM" : "OFFLINE"}</span></div>
        <div className="price-value">{last ? fmt(last.close) : "— — —"}</div>
        <div className={`price-change ${change >= 0 ? "up" : "down"}`}>{change >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />} {candles.length > 1 ? `${Math.abs(change).toFixed(3)}%` : "Collecting candles"} <span>· over the {candles.length} candles shown</span></div>
        <CandleChart candles={candles} overlays={overlays} markers={markers} />
        {!live && <div className="feed-note">{info.message}{market.group === "FOREX" ? " Forex markets are closed on weekends; synthetic indices trade 24/7." : ""}</div>}
        <div className="chart-footer"><span>LAST CANDLE <b>{last ? new Date(last.time * 1000).toLocaleTimeString("en-GB", { hour12: false }) : "Waiting…"}</b></span><span>NO ORDERS PLACED</span></div></div></section>
    <div className="section-heading lower"><div><div className="eyebrow">02 / CAPITAL PRESERVATION</div><h3>Risk engine</h3></div><span className="safe-label"><ShieldCheck size={14} /> CONSERVATIVE PRESET</span></div>
    <RiskPanel />
  </>;
}

import { useState } from "react";
import { Download, Play, RotateCcw, ScrollText } from "lucide-react";
import { GRANULARITIES } from "../../shared/candles.js";
import { DEFAULT_SIM } from "../../shared/sim.js";
import { defaultParams, getStrategy, strategies } from "../../shared/strategy.js";
import { clock, clockSeconds, downloadText, eventsToCsv, fmt, money, signedMoney } from "../lib/format";
import { MARKETS } from "../lib/markets";
import type { usePaper } from "../hooks/usePaper";

type Paper = ReturnType<typeof usePaper>;

export default function PaperTrading({ paper }: { paper: Paper }) {
  const { session, info, start, reset } = paper;
  const [symbol, setSymbol] = useState<string>("R_100");
  const [granularity, setGranularity] = useState(60);
  const [strategyId, setStrategyId] = useState(strategies[0].id);
  const [balance, setBalance] = useState(1000);

  const begin = () => {
    const s = getStrategy(strategyId);
    start({ symbol, granularity, strategyId: s.id, params: defaultParams(s), cfg: { ...DEFAULT_SIM }, startedAt: Date.now() }, Math.max(10, balance));
  };

  if (!session) return <div className="lab">
    <div className="section-heading"><div><div className="eyebrow">04 / FORWARD TEST</div><h3>Paper trading</h3></div><span className="safe-label"><Play size={14} /> SIMULATED · NO BROKER CONNECTED</span></div>
    <section className="panel">
      <p className="hint">Runs a strategy on the live Deriv feed with a virtual balance. Every signal must pass the risk gate. Orders are simulated at the next candle open; nothing is sent to any account.</p>
      <div className="fields four">
        <label>Market<select value={symbol} onChange={e => setSymbol(e.target.value)}>{MARKETS.map(m => <option key={m.symbol} value={m.symbol}>{m.name}</option>)}</select></label>
        <label>Timeframe<select value={granularity} onChange={e => setGranularity(Number(e.target.value))}>{GRANULARITIES.map(g => <option key={g.seconds} value={g.seconds}>{g.label}</option>)}</select></label>
        <label>Strategy<select value={strategyId} onChange={e => setStrategyId(e.target.value)}>{strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Virtual balance ($)<input type="number" min={10} value={balance} onChange={e => setBalance(Number(e.target.value))} /></label>
      </div>
      <button className="primary-btn" onClick={begin}><Play size={14} /> Start paper session</button>
    </section></div>;

  const { state, meta } = session;
  const pnl = state.balance - state.startBalance;
  const wins = state.trades.filter(t => t.pnl > 0).length;
  const live = info.status === "LIVE";
  return <div className="lab">
    <div className="section-heading"><div><div className="eyebrow">04 / FORWARD TEST</div><h3>Paper trading</h3></div>
      <div className="feed-status"><span className={live ? "pulse" : "pulse muted"} />{info.status} · {meta.symbol} · {GRANULARITIES.find(g => g.seconds === meta.granularity)?.label}</div></div>
    <section className="panel">
      <div className="metrics-grid">
        <div className="metric"><small>VIRTUAL BALANCE</small><b>{money(state.balance)}</b></div>
        <div className={`metric ${pnl > 0 ? "up" : pnl < 0 ? "down" : ""}`}><small>SESSION P&amp;L</small><b>{signedMoney(pnl)}</b></div>
        <div className={`metric ${state.dayPnl < 0 ? "down" : ""}`}><small>TODAY (UTC)</small><b>{signedMoney(state.dayPnl)}</b></div>
        <div className="metric"><small>TRADES</small><b>{state.trades.length}{state.trades.length ? ` · ${Math.round((wins / state.trades.length) * 100)}% win` : ""}</b></div>
        <div className="metric"><small>BLOCKED BY GATE</small><b>{state.blockedSignals}</b></div>
        <div className="metric"><small>STRATEGY</small><b>{getStrategy(meta.strategyId).name}</b></div>
      </div>
      <p className="hint">{info.message}{info.lastDataAt ? ` Last data ${clockSeconds(info.lastDataAt)}.` : ""} The session only advances while this page is open. State is stored in this browser.</p>
      {state.position && <div className="risk-result pass"><b>OPEN PAPER {state.position.side}</b><span>Entry {fmt(state.position.entry)} · stop {fmt(state.position.stop)} · target {fmt(state.position.target)} · risk {money(state.position.risk)}</span><small>{state.position.reason}</small></div>}
      {!state.position && state.pending && <div className="risk-result pass"><b>SIGNAL PENDING</b><span>{state.pending.side} fills at the next candle open.</span><small>{state.pending.reason}</small></div>}
      <div className="btn-row"><button className="ghost-btn" onClick={() => downloadText(`paper-audit-${meta.symbol}.csv`, eventsToCsv(state.events))}><Download size={13} /> Export audit log</button>
        <button className="ghost-btn danger" onClick={() => { if (window.confirm("End this paper session and clear its audit log?")) reset(); }}><RotateCcw size={13} /> End session</button></div>
    </section>
    <section className="panel"><div className="card-title"><ScrollText size={17} /><b>Audit log</b><span className="card-status">NEWEST FIRST</span></div>
      <div className="table-wrap tall"><table><thead><tr><th>Candle time</th><th>Event</th><th>Detail</th></tr></thead>
        <tbody>{[...state.events].reverse().slice(0, 120).map((e, i) => <tr key={i}><td>{clock(e.time)}</td><td><span className={`tag ${e.type.toLowerCase()}`}>{e.type.replace("_", " ")}</span></td><td>{e.message}</td></tr>)}
          {!state.events.length && <tr><td colSpan={3}>No events yet.</td></tr>}</tbody></table></div></section>
  </div>;
}

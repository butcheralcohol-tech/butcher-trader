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
  const { session, info, start, reset, manualTrade, candles } = paper;
  const [symbol, setSymbol] = useState<string>("R_100");
  const [granularity, setGranularity] = useState(60);
  const [strategyIds, setStrategyIds] = useState<string[]>(strategies.slice(0, 3).map(s => s.id));
  const [consensusPercent, setConsensusPercent] = useState(60);
  const [balance, setBalance] = useState(1000);
  const [manualStopPercent, setManualStopPercent] = useState(0.5);
  const [manualRewardRisk, setManualRewardRisk] = useState(2);

  const begin = () => {
    if (!strategyIds.length) return;
    const selected = strategies.filter(s => strategyIds.includes(s.id));
    const first = selected[0];
    start({
      symbol, granularity, strategyId: first.id, params: defaultParams(first),
      strategyIds: selected.map(s => s.id),
      strategyParams: Object.fromEntries(selected.map(s => [s.id, defaultParams(s)])),
      consensusPercent, cfg: { ...DEFAULT_SIM }, startedAt: Date.now(),
    }, Math.max(10, balance));
  };
  const toggleStrategy = (id: string, checked: boolean) => setStrategyIds(current =>
    checked ? [...current, id] : current.filter(value => value !== id)
  );

  if (!session) return <div className="lab">
    <div className="section-heading"><div><div className="eyebrow">04 / FORWARD TEST</div><h3>Multi-strategy paper bot</h3></div><span className="safe-label"><Play size={14} /> SIMULATED · NO BROKER CONNECTED</span></div>
    <section className="panel">
      <p className="hint">Run several strategies together against the live Deriv candle feed. Each strategy votes LONG or SHORT when it has a signal; the bot only queues a paper order when one direction reaches your consensus threshold. All orders are virtual, filled at the next candle open, and pass the shared risk gate. Nothing is sent to a Deriv account.</p>
      <div className="fields four">
        <label>Market<select value={symbol} onChange={e => setSymbol(e.target.value)}>{MARKETS.map(m => <option key={m.symbol} value={m.symbol}>{m.name}</option>)}</select></label>
        <label>Timeframe<select value={granularity} onChange={e => setGranularity(Number(e.target.value))}>{GRANULARITIES.map(g => <option key={g.seconds} value={g.seconds}>{g.label}</option>)}</select></label>
        <label>Virtual balance ($)<input type="number" min={10} value={balance} onChange={e => setBalance(Number(e.target.value))} /></label>
        <label>Directional consensus<select value={consensusPercent} onChange={e => setConsensusPercent(Number(e.target.value))}><option value={50}>50% — simple majority</option><option value={60}>60% — balanced</option><option value={75}>75% — strict</option><option value={100}>100% — unanimous</option></select></label>
      </div>
      <div className="card-title spaced"><b>Enable strategy modules</b><span className="card-status">{strategyIds.length} OF {strategies.length} SELECTED</span></div>
      <div className="bot-cards">{strategies.map((strategy, i) => <article className={strategyIds.includes(strategy.id) ? "bot-card selected" : "bot-card"} key={strategy.id}>
        <div className="bot-card-top"><span className="bot-number">MODULE 0{i + 1}</span><label className="bot-mode"><input type="checkbox" checked={strategyIds.includes(strategy.id)} onChange={e => toggleStrategy(strategy.id, e.target.checked)} /> ENABLE</label></div>
        <h4>{strategy.name}</h4><p>{strategy.description}</p><div className="bot-card-foot"><span>{strategy.params.length} parameters · ATR risk levels</span><span>{strategyIds.includes(strategy.id) ? "ACTIVE VOTE" : "STANDBY"}</span></div>
      </article>)}</div>
      <p className="hint">The default is 3 enabled modules and 60% consensus. A strategy that emits no signal contributes no directional vote, but the threshold is calculated from all enabled modules. Conflicting or insufficient votes produce no trade.</p>
      <button className="primary-btn" disabled={!strategyIds.length || !Number.isFinite(balance) || balance < 10} onClick={begin}><Play size={14} /> Start multi-strategy paper bot</button>
    </section></div>;

  const { state, meta } = session;
  const pnl = state.balance - state.startBalance;
  const wins = state.trades.filter(t => t.pnl > 0).length;
  const live = info.status === "LIVE";
  const activeStrategies = (meta.strategyIds?.length ? meta.strategyIds : [meta.strategyId]).map(id => getStrategy(id).name);
  return <div className="lab">
    <div className="section-heading"><div><div className="eyebrow">04 / FORWARD TEST</div><h3>Multi-strategy paper bot</h3></div>
      <div className="feed-status"><span className={live ? "pulse" : "pulse muted"} />{info.status} · {meta.symbol} · {GRANULARITIES.find(g => g.seconds === meta.granularity)?.label}</div></div>
    <section className="panel">
      <div className="metrics-grid">
        <div className="metric"><small>VIRTUAL BALANCE</small><b>{money(state.balance)}</b></div>
        <div className={`metric ${pnl > 0 ? "up" : pnl < 0 ? "down" : ""}`}><small>SESSION P&amp;L</small><b>{signedMoney(pnl)}</b></div>
        <div className={`metric ${state.dayPnl < 0 ? "down" : ""}`}><small>TODAY (UTC)</small><b>{signedMoney(state.dayPnl)}</b></div>
        <div className="metric"><small>TRADES</small><b>{state.trades.length}{state.trades.length ? ` · ${Math.round((wins / state.trades.length) * 100)}% win` : ""}</b></div>
        <div className="metric"><small>BLOCKED BY GATE</small><b>{state.blockedSignals}</b></div>
        <div className="metric"><small>CONSENSUS</small><b>{meta.consensusPercent ?? 60}%</b></div>
      </div>
      <p className="hint">Enabled modules: {activeStrategies.join(" · ")}. {meta.consensusPercent ?? 60}% consensus required. {info.message}{info.lastDataAt ? ` Last data ${clockSeconds(info.lastDataAt)}.` : ""} The bot only runs while this page is open; session state is stored in this browser. All trades remain simulated.</p>
      <section className="panel manual-trading">
        <div className="card-title"><b>Manual trading</b><span className="card-status">PAPER ONLY</span></div>
        <p className="hint">Place a direction manually using the latest market quote. The order is queued for the next candle open, then checked by the same position and daily-loss risk gates. No Deriv account order is sent.</p>
        <div className="fields four">
          <label>Stop distance (%)<input type="number" min={0.1} max={5} step={0.1} value={manualStopPercent} onChange={e => setManualStopPercent(Number(e.target.value))} /></label>
          <label>Target reward/risk<select value={manualRewardRisk} onChange={e => setManualRewardRisk(Number(e.target.value))}><option value={1}>1:1</option><option value={1.5}>1.5:1</option><option value={2}>2:1</option><option value={3}>3:1</option><option value={4}>4:1</option><option value={5}>5:1</option></select></label>
          <label>Reference price<input value={candles.length ? fmt(candles[candles.length - 1].close) : "Waiting for live quote"} readOnly /></label>
        </div>
        <div className="btn-row">
          <button className="primary-btn" disabled={!live || !candles.length || Boolean(state.position || state.pending) || manualStopPercent < 0.1 || manualStopPercent > 5} onClick={() => manualTrade("LONG", manualStopPercent, manualRewardRisk)}>Manual LONG</button>
          <button className="ghost-btn danger" disabled={!live || !candles.length || Boolean(state.position || state.pending) || manualStopPercent < 0.1 || manualStopPercent > 5} onClick={() => manualTrade("SHORT", manualStopPercent, manualRewardRisk)}>Manual SHORT</button>
        </div>
        <p className="hint">Buttons remain disabled unless the feed is live and no paper position or pending entry exists. Allowed stop distance: 0.1–5%; target: 1:1–5:1.</p>
      </section>

      {state.position && <div className="risk-result pass"><b>OPEN PAPER {state.position.side}</b><span>Entry {fmt(state.position.entry)} · stop {fmt(state.position.stop)} · target {fmt(state.position.target)} · risk {money(state.position.risk)}</span><small>{state.position.reason}</small></div>}
      {!state.position && state.pending && <div className="risk-result pass"><b>SIGNAL PENDING</b><span>{state.pending.side} fills at the next candle open.</span><small>{state.pending.reason}</small></div>}
      <div className="btn-row"><button className="ghost-btn" onClick={() => downloadText(`paper-audit-${meta.symbol}.csv`, eventsToCsv(state.events))}><Download size={13} /> Export audit log</button>
        <button className="ghost-btn danger" onClick={() => { if (window.confirm("End this paper session and clear its audit log?")) reset(); }}><RotateCcw size={13} /> End session</button></div>
    </section>
    <section className="panel"><div className="card-title"><ScrollText size={17} /><b>Audit log</b><span className="card-status">NEWEST FIRST</span></div>
      <div className="table-wrap tall"><table><thead><tr><th>Candle time</th><th>Event</th><th>Detail</th></tr></thead>
        <tbody>{[...state.events].reverse().slice(0, 120).map((e, i) => <tr key={i}><td>{clock(e.time)}</td><td><span className={`tag ${e.type.toLowerCase()}`}>{e.type.replace("_", " ")}</span></td><td>{e.message}</td></tr>)}
          {!state.events.length && <tr><td colSpan={3}>No events yet.</td></tr>}</tbody></table></div></section>
    <section className="warning-note"><b>Execution status</b><p>This version automatically executes the selected strategy ensemble in the virtual portfolio only. Real Deriv orders are still blocked because authenticated trading WebSocket handling, demo-account order verification, durable server-side risk enforcement and idempotent order reconciliation have not yet passed integration tests. Do not treat paper fills as broker fills.</p></section>
  </div>;
}

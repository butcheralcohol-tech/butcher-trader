import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CircleStop, Radio, ShieldCheck } from "lucide-react";
import { GRANULARITIES } from "../../shared/candles.js";
import CandleChart from "./CandleChart";
import { useLiveFeed } from "../hooks/useLiveFeed";
import { fmt, money, signedMoney } from "../lib/format";
import { MARKETS } from "../lib/markets";

type Side = "LONG" | "SHORT";
type ManualPosition = { side: Side; entry: number; stake: number; openedAt: number };
type ClosedTrade = { side: Side; entry: number; exit: number; stake: number; pnl: number; openedAt: number; closedAt: number };

export default function ManualTrading() {
  const [symbol, setSymbol] = useState<string>("R_100");
  const [granularity, setGranularity] = useState(60);
  const [stake, setStake] = useState(10);
  const [position, setPosition] = useState<ManualPosition | null>(null);
  const [history, setHistory] = useState<ClosedTrade[]>([]);
  const { candles, info } = useLiveFeed(symbol, granularity, 180);
  const last = candles[candles.length - 1];
  const live = info.status === "LIVE";
  const market = MARKETS.find(m => m.symbol === symbol)!;
  const overlays = useMemo(() => [], []);
  const pnl = position && last ? ((last.close - position.entry) / position.entry) * position.stake * (position.side === "LONG" ? 1 : -1) : 0;
  const open = (side: Side) => {
    if (!live || !last || position || !Number.isFinite(stake) || stake < 1 || stake > 1000) return;
    setPosition({ side, entry: last.close, stake, openedAt: last.time });
  };
  const close = () => {
    if (!position || !last) return;
    const result = ((last.close - position.entry) / position.entry) * position.stake * (position.side === "LONG" ? 1 : -1);
    setHistory(prev => [{ ...position, exit: last.close, pnl: result, closedAt: last.time }, ...prev].slice(0, 50));
    setPosition(null);
  };
  return <div className="lab">
    <div className="section-heading"><div><div className="eyebrow">05 / MANUAL EXECUTION PRACTICE</div><h3>Manual trading desk</h3></div><span className="safe-label"><ShieldCheck size={14} /> VIRTUAL ORDERS ONLY</span></div>
    <section className="panel manual-grid">
      <div>
        <p className="hint">Practice entries and exits against the live Deriv candle feed. These are simulated spot-style positions, not Deriv contracts; results exclude spread, contract payout rules, fees and slippage. No broker order is sent.</p>
        <div className="fields manual-fields">
          <label>Market<select value={symbol} disabled={!!position} onChange={e => setSymbol(e.target.value)}>{MARKETS.map(m => <option key={m.symbol} value={m.symbol}>{m.name} ({m.symbol})</option>)}</select></label>
          <label>Timeframe<select value={granularity} disabled={!!position} onChange={e => setGranularity(Number(e.target.value))}>{GRANULARITIES.map(g => <option key={g.seconds} value={g.seconds}>{g.label}</option>)}</select></label>
          <label>Virtual stake ($)<input type="number" min={1} max={1000} step={1} value={stake} disabled={!!position} onChange={e => setStake(Number(e.target.value))} /></label>
        </div>
        <div className="manual-quote"><span><small>LIVE FEED</small><b className={live ? "metric-good" : "metric-wait"}><Radio size={13} /> {info.status}</b></span><span><small>LAST PRICE</small><b>{last ? fmt(last.close) : "Waiting…"}</b></span><span><small>MARKET</small><b>{market.symbol}</b></span></div>
        <div className="manual-actions">
          <button className="manual-buy" disabled={!live || !last || !!position || stake < 1 || stake > 1000} onClick={() => open("LONG")}><ArrowUpRight size={16} /> Open virtual LONG</button>
          <button className="manual-sell" disabled={!live || !last || !!position || stake < 1 || stake > 1000} onClick={() => open("SHORT")}><ArrowDownRight size={16} /> Open virtual SHORT</button>
        </div>
        {position && <div className={pnl >= 0 ? "risk-result pass" : "risk-result blocked"}><b>VIRTUAL {position.side} OPEN</b><span>Entry {fmt(position.entry)} · Stake {money(position.stake)} · Unrealised P&amp;L {signedMoney(pnl)}</span><button className="primary-btn" disabled={!last} onClick={close}><CircleStop size={14} /> Close virtual position at latest price</button></div>}
        {!live && <div className="feed-note">{info.message}</div>}
      </div>
      <div className="manual-chart"><div className="card-title"><Radio size={16} /><b>{market.name}</b><span className="card-status">{live ? "LIVE FEED" : "CONNECTING"}</span></div><CandleChart candles={candles} overlays={overlays} markers={[]} /><div className="chart-footer"><span>TIMEFRAME <b>{GRANULARITIES.find(g => g.seconds === granularity)?.label}</b></span><span>SIMULATED ONLY</span></div></div>
    </section>
    <section className="panel"><div className="card-title"><ShieldCheck size={17} /><b>Closed virtual trades</b><span className="card-status">{history.length} RECORDED</span></div>
      <div className="table-wrap"><table><thead><tr><th>Side</th><th>Entry</th><th>Exit</th><th>Stake</th><th>Simulated P&amp;L</th></tr></thead><tbody>{history.map((t, i) => <tr key={t.openedAt + "-" + i}><td><span className={t.side === "LONG" ? "tag filled" : "tag blocked"}>{t.side}</span></td><td>{fmt(t.entry)}</td><td>{fmt(t.exit)}</td><td>{money(t.stake)}</td><td className={t.pnl >= 0 ? "up" : "down"}>{signedMoney(t.pnl)}</td></tr>)}{!history.length && <tr><td colSpan={5}>No closed virtual trades yet.</td></tr>}</tbody></table></div>
    </section>
    <section className="warning-note"><b>Before using real money</b><p>This panel is deliberately isolated from the broker. Deriv account OAuth, authenticated WebSocket session management, contract proposals, order execution and server-side risk enforcement must be implemented and tested separately before any real order can be sent.</p></section>
  </div>;
}

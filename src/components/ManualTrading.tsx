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
  const [brokerStake, setBrokerStake] = useState(2);
  const [duration, setDuration] = useState(1);
  const [brokerBusy, setBrokerBusy] = useState(false);
  const [brokerMessage, setBrokerMessage] = useState("Connect a Deriv virtual account before placing demo orders.");
  const [brokerOrders, setBrokerOrders] = useState<Array<Record<string, unknown>>>([]);
  const [brokerAccount, setBrokerAccount] = useState("");
  const refreshBrokerOrders = async () => {
    try {
      const response = await fetch("/api/deriv/trades", { credentials: "same-origin", cache: "no-store" });
      const data = await response.json() as { error?: string; account?: string; trades?: Array<Record<string, unknown>> };
      if (!response.ok) throw new Error(data.error || "Could not reconcile broker history.");
      setBrokerAccount(data.account || "");
      setBrokerOrders(Array.isArray(data.trades) ? data.trades : []);
      setBrokerMessage("Broker history refreshed. Contract statuses are reported from Deriv.");
    } catch (error) {
      setBrokerMessage(error instanceof Error ? error.message : "Could not load broker history.");
    }
  };
  const placeBrokerOrder = async (contractType: "CALL" | "PUT") => {
    if (brokerBusy || !Number.isFinite(brokerStake) || brokerStake <= 0) return;
    setBrokerBusy(true);
    setBrokerMessage("Submitting demo order to Deriv and waiting for broker confirmation…");
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.() || `bt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const response = await fetch("/api/deriv/trade", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ symbol, contractType, duration, durationUnit: "m", stake: brokerStake }),
      });
      const data = await response.json() as { error?: string; reasons?: string[]; contractId?: number; status?: string; account?: string; stake?: number; currency?: string; liveTradingEnabled?: boolean };
      if (!response.ok) throw new Error([data.error, ...(data.reasons || [])].filter(Boolean).join(" "));
      setBrokerMessage(`Deriv confirmed demo contract #${data.contractId} · ${data.stake} ${data.currency} · status ${data.status}.`);
      setBrokerAccount(data.account || "");
      await refreshBrokerOrders();
    } catch (error) {
      setBrokerMessage(error instanceof Error ? error.message : "Demo order failed. Check Deriv connection and server configuration.");
    } finally {
      setBrokerBusy(false);
    }
  };
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
    <section className="panel">
      <div className="card-title"><b>Deriv broker orders</b><span className="card-status">VIRTUAL ACCOUNT ONLY</span></div>
      <p className="hint">These controls submit a real contract to your authenticated Deriv virtual account. They are separate from the simulated LONG/SHORT practice controls below. Server-side checks enforce demo-account verification, stake risk, daily locks, open-contract limits and duplicate-request protection.</p>
      <div className="fields four">
        <label>Contract stake ($)<input type="number" min="0.01" step="0.01" value={brokerStake} disabled={brokerBusy} onChange={e => setBrokerStake(Number(e.target.value))} /></label>
        <label>Duration<select value={duration} disabled={brokerBusy} onChange={e => setDuration(Number(e.target.value))}><option value={1}>1 minute</option><option value={2}>2 minutes</option><option value={3}>3 minutes</option><option value={5}>5 minutes</option><option value={10}>10 minutes</option></select></label>
      </div>
      <div className="manual-actions">
        <button className="manual-buy" disabled={brokerBusy || !Number.isFinite(brokerStake) || brokerStake <= 0} onClick={() => placeBrokerOrder("CALL")}>{brokerBusy ? "Submitting…" : "Place Deriv demo CALL"}</button>
        <button className="manual-sell" disabled={brokerBusy || !Number.isFinite(brokerStake) || brokerStake <= 0} onClick={() => placeBrokerOrder("PUT")}>{brokerBusy ? "Submitting…" : "Place Deriv demo PUT"}</button>
      </div>
      <p className="hint" role="status">{brokerMessage}{brokerAccount ? ` · Account ${brokerAccount}` : ""}</p>
      <div className="btn-row"><button className="ghost-btn" disabled={brokerBusy} onClick={refreshBrokerOrders}>Refresh broker-confirmed history</button></div>
      <div className="table-wrap"><table><thead><tr><th>Contract</th><th>Market</th><th>Stake</th><th>Status</th><th>Broker P&amp;L</th></tr></thead><tbody>
        {brokerOrders.map((order, i) => { const result = order.result as Record<string, unknown> | undefined; const broker = order.broker as Record<string, unknown> | undefined; return <tr key={String(order.contractId ?? i)}><td>{order.contractId ? `#${order.contractId}` : "—"}</td><td>{String(order.symbol ?? "—")}</td><td>{order.stake != null ? `${order.stake} ${String(order.currency ?? "")}` : "—"}</td><td>{String(order.status ?? "unknown")}{order.brokerConfirmed ? " · confirmed" : " · verify"}</td><td>{result?.profit != null ? String(result.profit) : broker?.profit != null ? String(broker.profit) : "Pending"}</td></tr>; })}
        {!brokerOrders.length && <tr><td colSpan={5}>No broker order records loaded. Connect Deriv, then refresh history.</td></tr>}
      </tbody></table></div>
    </section>
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

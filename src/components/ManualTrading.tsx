import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CircleStop, Radio, ShieldCheck } from "lucide-react";
import { GRANULARITIES } from "../../shared/candles.js";
import CandleChart from "./CandleChart";
import { useLiveFeed } from "../hooks/useLiveFeed";
import { fmt, money, signedMoney } from "../lib/format";
import { MARKETS } from "../lib/markets";

type Side = "LONG" | "SHORT";
type ManualPosition = { side: Side; entry: number; stake: number; openedAt: number };
type ClosedTrade = { side: Side; entry: number; exit: number; stake: number; pnl: number; openedAt: number; closedAt: number };
type DiscoveredContract = { contractType: string; label: string; category: string; minDuration: unknown; maxDuration: unknown; barriers?: unknown; expiryType?: unknown };
const BROKER_CONTRACTS = [
  { value: "CALL", label: "Rise / CALL", unit: "m", barrier: false, limits: false },
  { value: "PUT", label: "Fall / PUT", unit: "m", barrier: false, limits: false },
  { value: "DIGITUNDER", label: "Digit Under", unit: "t", barrier: true, limits: false },
  { value: "DIGITOVER", label: "Digit Over", unit: "t", barrier: true, limits: false },
  { value: "DIGITMATCH", label: "Digit Matches", unit: "t", barrier: true, limits: false },
  { value: "DIGITDIFF", label: "Digit Differs", unit: "t", barrier: true, limits: false },
  { value: "DIGITEVEN", label: "Digit Even", unit: "t", barrier: false, limits: false },
  { value: "DIGITODD", label: "Digit Odd", unit: "t", barrier: false, limits: false },
  { value: "MULTUP", label: "Multiplier Up (x10)", unit: "m", barrier: false, limits: true },
  { value: "MULTDOWN", label: "Multiplier Down (x10)", unit: "m", barrier: false, limits: true },
] as const;

export default function ManualTrading() {
  const [symbol, setSymbol] = useState<string>("R_100");
  const [granularity, setGranularity] = useState(60);
  const [stake, setStake] = useState(10);
  const [position, setPosition] = useState<ManualPosition | null>(null);
  const [history, setHistory] = useState<ClosedTrade[]>([]);
  const [brokerStake, setBrokerStake] = useState(2);
  const [duration, setDuration] = useState(1);
  const [contractType, setContractType] = useState<string>("CALL");
  const [barrier, setBarrier] = useState("6");
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [brokerBusy, setBrokerBusy] = useState(false);
  const [brokerMessage, setBrokerMessage] = useState("Connect a Deriv virtual account before placing demo orders.");
  const [brokerOrders, setBrokerOrders] = useState<Array<Record<string, unknown>>>([]);
  const [brokerAccount, setBrokerAccount] = useState("");
  const [discoveredContracts, setDiscoveredContracts] = useState<DiscoveredContract[]>([]);
  const [durationUnit, setDurationUnit] = useState("m");
  const [barrier2, setBarrier2] = useState("");
  const [discoveryMessage, setDiscoveryMessage] = useState("Connect Deriv to load market-specific contract availability.");
  useEffect(() => {
    let active = true;
    setDiscoveryMessage("Checking Deriv contract availability…");
    fetch(`/api/deriv/contracts?symbol=${encodeURIComponent(symbol)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async response => {
        const data = await response.json() as { error?: string; contracts?: DiscoveredContract[] };
        if (!response.ok) throw new Error(data.error || "Contract discovery is unavailable.");
        if (!active) return;
        setDiscoveredContracts(Array.isArray(data.contracts) ? data.contracts : []);
        if (Array.isArray(data.contracts) && data.contracts.length && !data.contracts.some(item => item.contractType === contractType)) {
          const supported = data.contracts.filter(item => BROKER_CONTRACTS.some(c => c.value === item.contractType));
          setContractType(supported.some(item => item.contractType === "CALL") ? "CALL" : (supported[0]?.contractType ?? "CALL"));
        }
        setDiscoveryMessage(`Deriv returned ${Array.isArray(data.contracts) ? data.contracts.length : 0} available contract types for ${symbol}. The order menu remains limited to types implemented by the order endpoint.`);
      })
      .catch(error => {
        if (!active) return;
        setDiscoveredContracts([]);
        setDiscoveryMessage(error instanceof Error ? error.message : "Contract discovery failed.");
      });
    return () => { active = false; };
  }, [symbol]);
  const supportedDiscoveredContracts = discoveredContracts.filter(item => BROKER_CONTRACTS.some(c => c.value === item.contractType));
  const selectedContract = BROKER_CONTRACTS.find(c => c.value === contractType) ?? BROKER_CONTRACTS[0];
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
  const placeBrokerOrder = async () => {
    if (brokerBusy || !Number.isFinite(brokerStake) || brokerStake <= 0) return;
    setBrokerBusy(true);
    setBrokerMessage("Submitting demo proposal to Deriv; waiting for broker confirmation…");
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.() || `bt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const response = await fetch("/api/deriv/trade", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          symbol, contractType, duration, durationUnit: selectedContract.unit, stake: brokerStake,
          ...(selectedContract.barrier ? { barrier } : {}),
          ...(selectedContract.limits ? {
            ...(takeProfit.trim() ? { takeProfit: Number(takeProfit) } : {}),
            ...(stopLoss.trim() ? { stopLoss: Number(stopLoss) } : {}),
          } : {}),
        }),
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
      <p className="hint">These controls submit contracts only to an authenticated Deriv virtual account. The server validates the account, stake risk, daily locks, open-contract limits and duplicate-request protection. Availability depends on the selected market and Deriv contract rules.</p>
      <p className="hint" role="status">{discoveryMessage}</p>
      {discoveredContracts.length > 0 && <details className="contract-discovery"><summary>View broker-discovered contract types ({discoveredContracts.length})</summary><div className="table-wrap"><table><thead><tr><th>Type</th><th>Category</th><th>Duration range</th></tr></thead><tbody>{discoveredContracts.map(contract => <tr key={contract.contractType}><td>{contract.label} <small>({contract.contractType})</small></td><td>{contract.category || "—"}</td><td>{String(contract.minDuration ?? "—")} – {String(contract.maxDuration ?? "—")}</td></tr>)}</tbody></table></div></details>}
      <div className="fields four">
        <label>Market<select value={symbol} disabled={brokerBusy} onChange={e => setSymbol(e.target.value)}>{MARKETS.map(m => <option key={m.symbol} value={m.symbol}>{m.name} ({m.symbol})</option>)}</select></label>
        <label>Contract<select value={contractType} disabled={brokerBusy} onChange={e => { setContractType(e.target.value); const found = discoveredContracts.find(item => item.contractType === e.target.value); const unit = typeof found?.minDuration === "string" ? String(found.minDuration).match(/[tsmhd]$/)?.[0] : null; if (unit) setDurationUnit(unit); }}>{(supportedDiscoveredContracts.length ? supportedDiscoveredContracts : BROKER_CONTRACTS.map(c => ({ contractType: c.value, label: c.label, category: "", minDuration: null, maxDuration: null }))).map(c => <option key={c.contractType} value={c.contractType}>{c.label} ({c.contractType})</option>)}</select></label>
        <label>Contract stake ($)<input type="number" min="0.01" step="0.01" value={brokerStake} disabled={brokerBusy} onChange={e => setBrokerStake(Number(e.target.value))} /></label>
        <label>Duration unit<select value={selectedContract.unit === "t" ? "t" : durationUnit} disabled={brokerBusy || selectedContract.unit === "t"} onChange={e => setDurationUnit(e.target.value)}>{["t","s","m","h","d"].map(unit => <option key={unit} value={unit}>{({t:"Ticks",s:"Seconds",m:"Minutes",h:"Hours",d:"Days"} as Record<string,string>)[unit]}</option>)}</select></label><label>Duration value<input type="number" min="1" max="365" step="1" value={duration} disabled={brokerBusy} onChange={e => setDuration(Number(e.target.value))} /></label>
        {selectedContract.barrier && <><label>{contractType.startsWith("DIGIT") ? "Digit prediction (0–9)" : "Barrier / level"}<input type="number" min={contractType.startsWith("DIGIT") ? 0 : undefined} max={contractType.startsWith("DIGIT") ? 9 : undefined} step="any" value={barrier} disabled={brokerBusy} onChange={e => setBarrier(e.target.value)} /></label>{contractType === "RANGE" && <label>Second barrier / upper level<input type="number" step="any" value={barrier2} disabled={brokerBusy} onChange={e => setBarrier2(e.target.value)} /></label>}</>}
        {selectedContract.limits && <label>Take-profit amount ($, optional)<input type="number" min="0.01" step="0.01" value={takeProfit} disabled={brokerBusy} placeholder="No take profit" onChange={e => setTakeProfit(e.target.value)} /></label>}
        {selectedContract.limits && <label>Stop-loss amount ($, optional)<input type="number" min="0.01" step="0.01" value={stopLoss} disabled={brokerBusy} placeholder="No stop loss" onChange={e => setStopLoss(e.target.value)} /></label>}
      </div>
      <div className="manual-actions">
        <button className="manual-buy" disabled={brokerBusy || !Number.isFinite(brokerStake) || brokerStake <= 0 || (selectedContract.barrier && !/^[0-9]$/.test(barrier)) || (takeProfit !== "" && (!Number.isFinite(Number(takeProfit)) || Number(takeProfit) <= 0)) || (stopLoss !== "" && (!Number.isFinite(Number(stopLoss)) || Number(stopLoss) <= 0))} onClick={placeBrokerOrder}>{brokerBusy ? "Submitting…" : `Place demo ${selectedContract.label} contract`}</button>
      </div>
      {selectedContract.limits && <p className="hint">Take-profit and stop-loss are sent as broker limit-order parameters. If Deriv rejects them for this contract or market, the order will fail closed; do not assume protection until the broker confirms it.</p>}
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
    <section className="warning-note"><b>Real-money trading remains disabled</b><p>Only virtual-account orders are allowed. The contract menu is a limited initial set, not every Deriv contract type. Broker support, proposal acceptance, TP/SL behavior and settlement reconciliation must be verified in demo before expanding coverage.</p></section>
  </div>;
}

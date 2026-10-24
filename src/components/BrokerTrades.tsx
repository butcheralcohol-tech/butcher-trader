import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { clockSeconds, money, signedMoney } from "../lib/format";
import { useDerivAccounts } from "../lib/derivAccounts";
import AccountPicker from "./AccountPicker";

type Trade = Record<string, unknown>;
const text = (v: unknown, fallback = "—") => (v === null || v === undefined || v === "" ? fallback : String(v));
const profitOf = (t: Trade): number | null => {
  const result = t.result as Record<string, unknown> | undefined, broker = t.broker as Record<string, unknown> | undefined;
  const v = result?.profit ?? broker?.profit;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/** Broker-confirmed trades for the selected account (demo or real), reconciled against Deriv's own open contracts and profit table. */
export default function BrokerTrades() {
  const { selected, connected } = useDerivAccounts();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [message, setMessage] = useState("Select an account to load its broker-confirmed trades.");
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/deriv/trades?accountId=${encodeURIComponent(selected.id)}`, { credentials: "same-origin", cache: "no-store" });
      const data = await response.json() as { error?: string; trades?: Trade[] };
      if (!response.ok) throw new Error(data.error || "Could not reconcile broker history.");
      setTrades(Array.isArray(data.trades) ? data.trades : []);
      setCheckedAt(Date.now());
      setMessage(`Reconciled with Deriv for ${selected.id}.`);
    } catch (error) {
      setTrades([]);
      setMessage(error instanceof Error ? error.message : "Could not load broker trades.");
    } finally { setBusy(false); }
  }, [selected?.id]);

  useEffect(() => {
    setTrades([]); setCheckedAt(null);
    if (!selected) return;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 30000);
    return () => clearInterval(timer);
  }, [selected?.id, refresh]);

  const summary = useMemo(() => {
    const closed = trades.filter(t => t.status === "closed"), pnl = closed.reduce((s, t) => s + (profitOf(t) ?? 0), 0);
    return { open: trades.filter(t => t.status === "open").length, closed: closed.length, wins: closed.filter(t => (profitOf(t) ?? 0) > 0).length, unreconciled: trades.filter(t => t.status === "unreconciled").length, pnl };
  }, [trades]);

  return <div className="lab">
    <div className="section-heading"><div><div className="eyebrow">TRADES</div><h3>Broker-confirmed trades</h3></div>
      <span className={`safe-label ${selected?.kind === "real" ? "danger" : ""}`}>{selected ? (selected.kind === "real" ? "REAL ACCOUNT" : "DEMO ACCOUNT") : "NO ACCOUNT"}</span></div>
    <section className="panel">
      <AccountPicker />
      {selected && <>
        <div className="metrics-grid">
          <div className="metric"><small>OPEN</small><b>{summary.open}</b></div>
          <div className="metric"><small>CLOSED</small><b>{summary.closed}{summary.closed ? ` · ${Math.round((summary.wins / summary.closed) * 100)}% win` : ""}</b></div>
          <div className={`metric ${summary.pnl > 0 ? "up" : summary.pnl < 0 ? "down" : ""}`}><small>REALISED P&amp;L (LISTED)</small><b>{signedMoney(summary.pnl)}</b></div>
          <div className={`metric ${summary.unreconciled ? "down" : ""}`}><small>UNRECONCILED</small><b>{summary.unreconciled}</b></div>
        </div>
        <div className="btn-row"><button className="ghost-btn" disabled={busy} onClick={() => void refresh()}><RefreshCw size={13} /> {busy ? "Checking Deriv…" : "Refresh now"}</button></div>
        <p className="hint" role="status">{message}{checkedAt ? ` Last checked ${clockSeconds(checkedAt)}; refreshes every 30 seconds.` : ""}</p>
        <div className="table-wrap tall"><table><thead><tr><th>Mode</th><th>Contract</th><th>Market</th><th>Type</th><th>Stake</th><th>Status</th><th>Broker P&amp;L</th><th>Submitted</th></tr></thead><tbody>
          {[...trades].sort((a, b) => String(b.submittedAt ?? "").localeCompare(String(a.submittedAt ?? ""))).map((t, i) => {
            const p = profitOf(t);
            return <tr key={String(t.contractId ?? i)}>
              <td><span className={`tag ${t.mode === "real" ? "gate_blocked" : "signal"}`}>{text(t.mode, "demo").toUpperCase()}</span></td>
              <td>{t.contractId ? `#${text(t.contractId)}` : "—"}</td><td>{text(t.symbol)}</td><td>{text(t.contractType)}</td>
              <td>{typeof t.stake === "number" ? money(t.stake) : "—"}</td>
              <td>{text(t.status, "unknown")}{t.brokerConfirmed ? " · confirmed" : " · verify"}</td>
              <td className={p === null ? "" : p >= 0 ? "up" : "down"}>{p === null ? "Pending" : signedMoney(p)}</td>
              <td>{t.submittedAt ? new Date(String(t.submittedAt)).toLocaleString("en-GB", { hour12: false }) : "—"}</td></tr>;
          })}
          {!trades.length && <tr><td colSpan={8}>{connected ? "No orders placed through BUTCHER TRADER on this account yet." : "Connect Deriv to load trades."}</td></tr>}
        </tbody></table></div>
        <p className="hint">Only orders placed through this app are listed. Anything Deriv cannot match to an open contract or a settled transaction is shown as “unreconciled” and must be checked on Deriv before another order is placed.</p>
      </>}
    </section></div>;
}

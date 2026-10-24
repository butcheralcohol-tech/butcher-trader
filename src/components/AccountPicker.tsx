import { ShieldAlert, ShieldCheck } from "lucide-react";
import { REAL_CONFIRM_PHRASE } from "../../shared/real-gate.js";
import { fmt } from "../lib/format";
import { selectAccount, setRealPhrase, useDerivAccounts } from "../lib/derivAccounts";

/** Chooses which Deriv account orders and history apply to. Demo is the default; a real account needs the typed phrase on top of the server-side gates. */
export default function AccountPicker() {
  const { loaded, connected, accounts, selected, realPhrase, realConfirmed, error } = useDerivAccounts();
  if (!loaded) return <p className="hint">Loading Deriv accounts…</p>;
  if (!connected) return <p className="hint">Connect your Deriv account (Deriv account tab) to place orders and see broker trades.</p>;
  if (!accounts.length) return <p className="hint">No Options trading accounts were returned by Deriv.{error ? ` ${error}` : ""}</p>;
  return <div className={`account-picker ${selected?.kind === "real" ? "is-real" : ""}`}>
    <label>Trading account
      <select value={selected?.id ?? ""} onChange={e => selectAccount(e.target.value)}>
        {!selected && <option value="">Select an account…</option>}
        {accounts.map(a => <option key={a.id} value={a.id}>{a.kind === "real" ? "REAL" : "DEMO"} · {a.id}{a.balance !== null ? ` · ${a.currency} ${fmt(a.balance, 2)}` : ""}</option>)}
      </select></label>
    {selected?.kind === "demo" && <p className="hint"><ShieldCheck size={13} /> Virtual money. Safe for testing the robot end to end.</p>}
    {selected?.kind === "real" && <div className="risk-result blocked">
      <b><ShieldAlert size={14} /> REAL MONEY ACCOUNT SELECTED</b>
      <small>Orders use real funds and can lose the whole stake. The server also refuses real orders unless the owner has enabled them for this exact account and enough demo orders have been confirmed.</small>
      <label>Type <code>{REAL_CONFIRM_PHRASE}</code> to allow real orders in this session
        <input type="text" autoComplete="off" spellCheck={false} value={realPhrase} placeholder={REAL_CONFIRM_PHRASE} onChange={e => setRealPhrase(e.target.value)} /></label>
      <span>{realConfirmed ? "Confirmed for this browser session." : "Not confirmed — real orders will be rejected."}</span>
    </div>}
  </div>;
}

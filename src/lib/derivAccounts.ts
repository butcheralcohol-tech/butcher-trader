import { useEffect, useSyncExternalStore } from "react";
import { classifyAccount, type AccountKind } from "../../shared/account-kind.js";
import { REAL_CONFIRM_PHRASE } from "../../shared/real-gate.js";

export type TradingAccount = { id: string; kind: Exclude<AccountKind, "unsupported">; currency: string; balance: number | null };
type Store = { loaded: boolean; connected: boolean; accounts: TradingAccount[]; selectedId: string; error: string; realPhrase: string };

const KEY = "butcher.account.v1";
let state: Store = { loaded: false, connected: false, accounts: [], selectedId: "", error: "", realPhrase: "" };
const listeners = new Set<() => void>();
let started = false;
const set = (patch: Partial<Store>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); };
const read = () => { try { return sessionStorage.getItem(KEY) ?? ""; } catch { return ""; } };
const write = (id: string) => { try { sessionStorage.setItem(KEY, id); } catch { /* storage unavailable */ } };

type SessionAccount = { account_id?: string; currency?: string; balance?: number };

/** Loads the connected Deriv accounts once. Wallets and unknown IDs are dropped, and a REAL account is never selected automatically. */
export async function loadAccounts(force = false): Promise<void> {
  if (started && !force) return;
  started = true;
  try {
    const response = await fetch("/api/deriv/session", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error("Session status unavailable.");
    const data = await response.json() as { connected?: boolean; accounts?: SessionAccount[]; accountError?: string | null };
    const accounts: TradingAccount[] = (Array.isArray(data.accounts) ? data.accounts : []).flatMap(a => {
      const id = String(a.account_id ?? "").toUpperCase(), kind = classifyAccount(id);
      return kind === "unsupported" ? [] : [{ id, kind, currency: String(a.currency ?? ""), balance: typeof a.balance === "number" ? a.balance : null }];
    });
    const remembered = read();
    const selectedId = accounts.some(a => a.id === remembered) ? remembered : (accounts.find(a => a.kind === "demo")?.id ?? "");
    set({ loaded: true, connected: Boolean(data.connected), accounts, selectedId, error: data.accountError ?? "" });
  } catch (error) {
    set({ loaded: true, connected: false, accounts: [], selectedId: "", error: error instanceof Error ? error.message : "Could not load accounts." });
  }
}

export function selectAccount(id: string) { write(id); set({ selectedId: id, realPhrase: "" }); }
export function setRealPhrase(phrase: string) { set({ realPhrase: phrase }); }

export function useDerivAccounts() {
  useEffect(() => { void loadAccounts(); }, []);
  const snap = useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state);
  const selected = snap.accounts.find(a => a.id === snap.selectedId) ?? null;
  const realConfirmed = selected?.kind === "real" && snap.realPhrase === REAL_CONFIRM_PHRASE;
  return {
    ...snap, selected, realConfirmed,
    /** Extra request fields for the order endpoint: the account, plus the typed phrase only when a real account is selected. */
    orderFields: selected ? { accountId: selected.id, ...(selected.kind === "real" ? { realMoneyConfirmation: snap.realPhrase } : {}) } : null,
  };
}

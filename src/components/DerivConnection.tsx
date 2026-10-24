import { useEffect, useState } from "react";
import { ExternalLink, KeyRound, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";

type SessionStatus = {
  connected: boolean;
  configured: boolean;
  expiresAt: number | null;
  accounts?: Array<{ account_id?: string; account_type?: string; is_virtual?: number; currency?: string }>;
  accountError?: string | null;
};

const oauthFailureMessages: Record<string, string> = {
  provider_error:
    "Deriv returned an authorization error or the sign-in was cancelled. Start a fresh connection attempt.",
  missing_state_cookie:
    "The browser did not return the OAuth state cookie. Allow cookies for butcherfx.vercel.app and retry.",
  missing_pkce_cookie:
    "The browser did not return the PKCE verifier cookie. Allow cookies for butcherfx.vercel.app and retry.",
  missing_returned_state:
    "Deriv returned without the required state parameter. Start a fresh connection attempt.",
  state_mismatch:
    "The OAuth state check failed. For your security, the callback was rejected. Start a fresh connection attempt.",
  missing_code:
    "Deriv did not return a usable authorization code. Start a fresh connection attempt.",
  oauth_misconfigured:
    "OAuth server configuration is incomplete. Check the Vercel environment variables.",
  token_exchange_rejected:
    "Deriv rejected the authorization-code exchange. The code may be expired/used, the PKCE verifier may not match, or the registered client/redirect URI may not match.",
  token_response_invalid:
    "Deriv returned an unexpected token response. No session was saved.",
  session_cookie_too_large:
    "The encrypted session did not fit safely in a browser cookie. No session was saved.",
  session_storage_failed:
    "The encrypted session could not be validated. No session was saved.",
  token_exchange_unavailable:
    "The token exchange could not be completed because of a network, timeout, or server error. Start a fresh connection attempt.",
};

export default function DerivConnection() {
  const [session, setSession] = useState<SessionStatus>({
    connected: false,
    configured: false,
    expiresAt: null,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams(window.location.search);
    const result = query.get("deriv_oauth");
    const reason = query.get("deriv_reason");
    if (result === "connected") {
      setMessage(
        "Deriv authorized successfully. Your session is stored in a secure HTTP-only cookie.",
      );
    } else if (result === "cancelled") {
      setMessage("Deriv sign-in was cancelled or declined.");
    } else if (result === "failed") {
      setMessage(
        oauthFailureMessages[reason ?? ""] ??
          "Deriv sign-in could not be completed. Start a fresh connection attempt.",
      );
    } else if (result === "misconfigured") {
      setMessage(
        oauthFailureMessages[reason ?? ""] ??
          "OAuth server configuration is incomplete. Check the Vercel environment variables.",
      );
    }

    fetch("/api/deriv/session", { credentials: "same-origin", cache: "no-store" })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<SessionStatus>)
          : Promise.reject(new Error("Session status unavailable")),
      )
      .then((value) => {
        if (active) setSession(value);
      })
      .catch(() => {
        if (active) setSession({ connected: false, configured: false, expiresAt: null });
      });
    return () => {
      active = false;
    };
  }, []);

  async function disconnect() {
    setBusy(true);
    try {
      const response = await fetch("/api/deriv/oauth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Could not end the session.");
      setSession((current) => ({ ...current, connected: false, expiresAt: null }));
      setMessage("Deriv session disconnected from this browser.");
    } catch {
      setMessage("Could not disconnect right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const demoAccount = session.accounts?.find((a) => /^VRTC|^DOT/i.test(a.account_id ?? ""));

  return (
    <div className="lab">
      <div className="section-heading">
        <div>
          <div className="eyebrow">06 / BROKER INTEGRATION</div>
          <h3>Deriv account connection</h3>
        </div>
        <span className="safe-label">
          <LockKeyhole size={14} /> LIVE TRADING LOCKED
        </span>
      </div>
      <section className="panel account-connect">
        <div className="account-icon">
          <KeyRound size={23} />
        </div>
        <div className="account-copy">
          <h3>Connect through Deriv OAuth</h3>
          <p>
            Sign in on Deriv and review the requested permission there. Never enter your Deriv
            password or paste an account token into this dashboard.
          </p>
          <div className="connection-state">
            <span className={session.connected ? "pulse" : "pulse muted"} />
            {session.connected
              ? "Deriv account connected"
              : session.configured
                ? "Not connected"
                : "OAuth server configuration required"}
          </div>
          {session.connected && session.expiresAt && (
            <small>Session expires {new Date(session.expiresAt).toLocaleTimeString()}</small>
          )}
          {session.connected && demoAccount?.account_id && (
            <small>Account {demoAccount.account_id} ({demoAccount.currency ?? "—"})</small>
          )}
          {session.accountError && <small role="alert">{session.accountError}</small>}
        </div>
        {session.connected ? (
          <button className="ghost-btn" onClick={disconnect} disabled={busy}>
            {busy ? "Disconnecting…" : "Disconnect"} <LogOut size={13} />
          </button>
        ) : (
          <a className="ghost-btn" href="/api/deriv/oauth/start">
            Connect Deriv account <ExternalLink size={13} />
          </a>
        )}
      </section>
      {message && (
        <section className="panel">
          <p role="status">{message}</p>
        </section>
      )}
      <section className="panel">
        <div className="card-title">
          <ShieldCheck size={17} />
          <b>Connection security</b>
          <span className="card-status">PKCE</span>
        </div>
        <ol className="setup-steps">
          <li>
            <b>Official Deriv sign-in</b>
            <span>
              Authentication is handled by Deriv. BUTCHER TRADER never asks for your Deriv
              password.
            </span>
            <a
              href="https://developers.deriv.com/docs/intro/oauth/"
              target="_blank"
              rel="noreferrer"
            >
              Read the official OAuth guide <ExternalLink size={12} />
            </a>
          </li>
          <li>
            <b>Protected authorization flow</b>
            <span>
              Fresh state and PKCE values are generated server-side. The callback validates state
              and exchanges the authorization code on the server.
            </span>
          </li>
          <li>
            <b>Private session storage</b>
            <span>
              The short-lived access token is encrypted and held in an HTTP-only, Secure,
              SameSite cookie. It is never returned to browser JavaScript. Sign in again when the
              session expires.
            </span>
          </li>
          <li>
            <b>Demo-first trading</b>
            <span>
              This connection does not place orders or enable live execution. Authenticated account
              data and broker order workflows still need separate implementation and testing.
            </span>
          </li>
        </ol>
      </section>
      <section className="warning-note">
        <b>Live execution remains disabled</b>
        <p>
          OAuth only authorizes the account session. It does not place trades. Real-account order
          execution is not implemented and remains hard-disabled.
        </p>
      </section>
    </div>
  );
}

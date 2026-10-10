import { ExternalLink, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";

const clientId = String(import.meta.env.VITE_DERIV_OAUTH_CLIENT_ID ?? "").trim();

export default function DerivConnection() {
  return <div className="lab">
    <div className="section-heading"><div><div className="eyebrow">06 / BROKER INTEGRATION</div><h3>Deriv account connection</h3></div><span className="safe-label"><LockKeyhole size={14} /> LIVE TRADING LOCKED</span></div>
    <section className="panel account-connect">
      <div className="account-icon"><KeyRound size={23} /></div>
      <div className="account-copy"><h3>Connect through Deriv OAuth</h3><p>Use Deriv's official sign-in and consent flow. Never enter your Deriv password or paste an account token into this dashboard.</p>
        <div className="connection-state"><span className={clientId ? "pulse" : "pulse muted"} />{clientId ? "OAuth client ID configured" : "OAuth app not configured"}</div>
      </div>
      <a className="ghost-btn" href="https://app.deriv.com/account/api-token" target="_blank" rel="noreferrer">Deriv account <ExternalLink size={13} /></a>
    </section>
    <section className="panel">
      <div className="card-title"><ShieldCheck size={17} /><b>Setup checklist</b><span className="card-status">REQUIRED</span></div>
      <ol className="setup-steps">
        <li><b>Register a Deriv OAuth application</b><span>In the Deriv developer dashboard, register BUTCHER TRADER and set the exact HTTPS callback URL for the deployed app.</span><a href="https://developers.deriv.com/docs/intro/oauth/" target="_blank" rel="noreferrer">Read the official OAuth guide <ExternalLink size={12} /></a></li>
        <li><b>Configure server-only credentials</b><span>Set <code>DERIV_OAUTH_CLIENT_ID</code>, <code>DERIV_OAUTH_CLIENT_SECRET</code>, <code>DERIV_OAUTH_REDIRECT_URI</code>, and a strong <code>SESSION_SECRET</code> in the deployment environment. Do not use VITE_ prefixes for secrets.</span></li>
        <li><b>Complete secure session exchange</b><span>The production callback must validate OAuth state/PKCE, exchange the code on the server, and keep credentials in an HTTP-only secure session. This repo does not yet implement that callback or authenticated account WebSocket.</span></li>
        <li><b>Test on a Deriv demo account first</b><span>Account balance display, proposal validation, order confirmation, idempotency, stop conditions, and audit logging must pass tests before enabling real-account execution.</span></li>
      </ol>
    </section>
    <section className="warning-note"><b>No fake connection status</b><p>This screen is a setup guide, not a completed login. A public market-data feed does not authenticate an account. Real-account orders remain disabled until the secure OAuth callback, authenticated Deriv session, server-side risk gate and explicit order-confirmation flow are implemented and verified.</p></section>
  </div>;
}

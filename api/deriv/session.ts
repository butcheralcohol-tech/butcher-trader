import type { IncomingMessage, ServerResponse } from "node:http";
import { OAUTH_COOKIE, decryptSession, parseCookies } from "../../shared/oauth-session.js";

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const secret = process.env.SESSION_SECRET ?? "";
  const configured = Boolean(process.env.DERIV_OAUTH_CLIENT_ID?.trim() && process.env.DERIV_OAUTH_REDIRECT_URI?.trim() && secret.length >= 32);
  if (!configured) {
    res.end(JSON.stringify({ connected: false, configured: false, expiresAt: null }));
    return;
  }
  const cookies = parseCookies(typeof req.headers.cookie === "string" ? req.headers.cookie : null);
  const session = decryptSession(cookies[OAUTH_COOKIE], secret);
  res.end(JSON.stringify({ connected: Boolean(session), configured: true, expiresAt: session?.expiresAt ?? null }));
}

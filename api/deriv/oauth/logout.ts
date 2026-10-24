import type { IncomingMessage, ServerResponse } from "node:http";
import { clearCookie, OAUTH_COOKIE } from "../../../shared/oauth-session.js";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const secret = process.env.SESSION_SECRET ?? "";
  let revoked = false;

  // Best-effort server-side revocation. If it fails, we still clear the local cookie.
  if (secret.length >= 32) {
    try {
      const { parseCookies, decryptSession } = await import("../../../shared/oauth-session.js");
      const cookies = parseCookies(typeof req.headers.cookie === "string" ? req.headers.cookie : null);
      const raw = cookies[OAUTH_COOKIE];
      if (raw) {
        const session = decryptSession(raw, secret);
        if (session && typeof session.accessToken === "string" && session.accessToken) {
          const response = await fetch("https://auth.deriv.com/oauth2/revoke", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: new URLSearchParams({
              token: session.accessToken,
              token_type_hint: "access_token",
            }),
            signal: AbortSignal.timeout(8000),
          });
          revoked = response.ok;
          if (!response.ok) {
            console.warn("[deriv-oauth] token revocation rejected", { status: response.status });
          }
        }
      }
    } catch {
      // Never surface token material or provider response bodies.
      console.warn("[deriv-oauth] token revocation unavailable");
    }
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Set-Cookie", clearCookie(OAUTH_COOKIE));
  res.end(JSON.stringify({ ok: true, connected: false, revoked }));
}

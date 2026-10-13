import type { IncomingMessage, ServerResponse } from "node:http";
import { clearCookie, cookie, decryptSession, encryptSession, OAUTH_COOKIE, OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, parseCookies, safeEqual } from "../../../shared/oauth-session.js";

const TOKEN_URL = "https://auth.deriv.com/oauth2/token";
const APP_ORIGIN = "https://butcher-trader-lemon.vercel.app";

function redirect(res: ServerResponse, location: string, cookies: string[]): void {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Set-Cookie", cookies);
  res.end();
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let requestUrl: URL;
  try { requestUrl = new URL(req.url ?? "/", `https://${req.headers.host ?? "butcher-trader-lemon.vercel.app"}`); } catch {
    redirect(res, `${APP_ORIGIN}/?view=account&deriv_oauth=failed`, [clearCookie(OAUTH_STATE_COOKIE), clearCookie(OAUTH_VERIFIER_COOKIE)]);
    return;
  }
  const cookies = parseCookies(typeof req.headers.cookie === "string" ? req.headers.cookie : null);
  const stateCookie = cookies[OAUTH_STATE_COOKIE];
  const verifier = cookies[OAUTH_VERIFIER_COOKIE];
  const returnedState = requestUrl.searchParams.get("state");
  const code = requestUrl.searchParams.get("code");
  const oauthError = requestUrl.searchParams.get("error");
  const clientId = process.env.DERIV_OAUTH_CLIENT_ID?.trim() ?? "";
  const redirectUri = process.env.DERIV_OAUTH_REDIRECT_URI?.trim() ?? "";
  const secret = process.env.SESSION_SECRET ?? "";
  const clearPending = [clearCookie(OAUTH_STATE_COOKIE), clearCookie(OAUTH_VERIFIER_COOKIE)];

  if (oauthError) { redirect(res, `${APP_ORIGIN}/?view=account&deriv_oauth=cancelled`, clearPending); return; }
  if (!stateCookie || !verifier || !returnedState || !safeEqual(stateCookie, returnedState) || !code || code.length > 4096) {
    redirect(res, `${APP_ORIGIN}/?view=account&deriv_oauth=failed`, clearPending); return;
  }
  if (!clientId || !redirectUri || secret.length < 32) {
    redirect(res, `${APP_ORIGIN}/?view=account&deriv_oauth=misconfigured`, clearPending); return;
  }

  try {
    const body = new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier });
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("Deriv token exchange failed.");
    const token = await response.json() as { access_token?: unknown; expires_in?: unknown; token_type?: unknown };
    if (typeof token.access_token !== "string" || !token.access_token || (token.token_type && token.token_type !== "Bearer")) throw new Error("Deriv returned an invalid token response.");
    const expiresIn = typeof token.expires_in === "number" && Number.isFinite(token.expires_in) ? Math.max(60, Math.min(token.expires_in, 3600)) : 3600;
    const expiresAt = Date.now() + expiresIn * 1000;
    const encrypted = encryptSession({ accessToken: token.access_token, expiresAt }, secret);
    if (encrypted.length > 3500 || !decryptSession(encrypted, secret)) throw new Error("Could not safely store the encrypted session.");
    redirect(res, `${APP_ORIGIN}/?view=account&deriv_oauth=connected`, [...clearPending, cookie(OAUTH_COOKIE, encrypted, expiresIn)]);
  } catch {
    redirect(res, `${APP_ORIGIN}/?view=account&deriv_oauth=failed`, clearPending);
  }
}

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  clearCookie,
  cookie,
  decryptSession,
  encryptSession,
  OAUTH_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  parseCookies,
  safeEqual,
} from "../../../shared/oauth-session.js";

const TOKEN_URL = "https://auth.deriv.com/oauth2/token";
const APP_ORIGIN = "https://butcherfx.vercel.app";

type FailureReason =
  | "provider_error"
  | "missing_state_cookie"
  | "missing_pkce_cookie"
  | "missing_returned_state"
  | "state_mismatch"
  | "missing_code"
  | "oauth_misconfigured"
  | "token_exchange_rejected"
  | "token_response_invalid"
  | "session_cookie_too_large"
  | "session_storage_failed"
  | "token_exchange_unavailable";

function redirect(res: ServerResponse, location: string, cookies: string[]): void {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Set-Cookie", cookies);
  res.end();
}

function accountRedirect(
  result: "failed" | "cancelled" | "misconfigured" | "connected",
  reason?: FailureReason,
): string {
  const target = new URL("/", APP_ORIGIN);
  target.searchParams.set("view", "account");
  target.searchParams.set("deriv_oauth", result);
  if (reason) target.searchParams.set("deriv_reason", reason);
  return target.toString();
}

function fail(res: ServerResponse, cookies: string[], reason: FailureReason): void {
  // Log only a fixed reason code. Never log authorization codes, cookies, verifier values, or tokens.
  console.warn("[deriv-oauth] callback failed", { reason });
  redirect(res, accountRedirect("failed", reason), cookies);
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let requestUrl: URL;
  try {
    requestUrl = new URL(req.url ?? "/", APP_ORIGIN);
  } catch {
    fail(res, [clearCookie(OAUTH_STATE_COOKIE), clearCookie(OAUTH_VERIFIER_COOKIE)], "missing_code");
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

  if (oauthError) {
    console.warn("[deriv-oauth] provider returned an OAuth error");
    redirect(res, accountRedirect("cancelled"), clearPending);
    return;
  }
  if (!stateCookie) { fail(res, clearPending, "missing_state_cookie"); return; }
  if (!verifier) { fail(res, clearPending, "missing_pkce_cookie"); return; }
  if (!returnedState) { fail(res, clearPending, "missing_returned_state"); return; }
  if (!safeEqual(stateCookie, returnedState)) { fail(res, clearPending, "state_mismatch"); return; }
  if (!code || code.length > 4096) { fail(res, clearPending, "missing_code"); return; }
  if (!clientId || !redirectUri || secret.length < 32) {
    redirect(res, accountRedirect("misconfigured", "oauth_misconfigured"), clearPending);
    return;
  }

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      // Record only the HTTP status; provider response bodies are deliberately not logged or surfaced.
      console.warn("[deriv-oauth] token exchange rejected", { status: response.status });
      fail(res, clearPending, "token_exchange_rejected");
      return;
    }

    const token = (await response.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
      token_type?: unknown;
    };
    if (
      typeof token.access_token !== "string" ||
      !token.access_token ||
      (token.token_type !== undefined &&
        (typeof token.token_type !== "string" || token.token_type.toLowerCase() !== "bearer"))
    ) {
      fail(res, clearPending, "token_response_invalid");
      return;
    }

    const expiresIn =
      typeof token.expires_in === "number" && Number.isFinite(token.expires_in)
        ? Math.max(60, Math.min(token.expires_in, 3600))
        : 3600;
    const expiresAt = Date.now() + expiresIn * 1000;

    const encrypted = encryptSession(
      { accessToken: token.access_token, expiresAt },
      secret,
    );
    if (encrypted.length > 3500) {
      fail(res, clearPending, "session_cookie_too_large");
      return;
    }
    if (!decryptSession(encrypted, secret)) {
      fail(res, clearPending, "session_storage_failed");
      return;
    }

    redirect(res, accountRedirect("connected"), [
      ...clearPending,
      cookie(OAUTH_COOKIE, encrypted, expiresIn),
    ]);
  } catch {
    fail(res, clearPending, "token_exchange_unavailable");
  }
}

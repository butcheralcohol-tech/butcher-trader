import { clearCookie, cookie, decryptSession, encryptSession, OAUTH_COOKIE, OAUTH_COOKIE_TTL_SECONDS, OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, parseCookies, safeEqual } from "../../../shared/oauth-session.js";

const TOKEN_URL = "https://auth.deriv.com/oauth2/token";
const APP_ORIGIN = "https://butcher-trader-lemon.vercel.app";

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const cookies = parseCookies(request.headers.get("cookie"));
  const stateCookie = cookies[OAUTH_STATE_COOKIE];
  const verifier = cookies[OAUTH_VERIFIER_COOKIE];
  const returnedState = requestUrl.searchParams.get("state");
  const code = requestUrl.searchParams.get("code");
  const oauthError = requestUrl.searchParams.get("error");
  const clientId = process.env.DERIV_OAUTH_CLIENT_ID?.trim() ?? "";
  const redirectUri = process.env.DERIV_OAUTH_REDIRECT_URI?.trim() ?? "";
  const secret = process.env.SESSION_SECRET ?? "";
  const clearPending = [clearCookie(OAUTH_STATE_COOKIE), clearCookie(OAUTH_VERIFIER_COOKIE)].join(", ");

  if (oauthError) return new Response(null, { status: 302, headers: { Location: `${APP_ORIGIN}/?deriv_oauth=cancelled`, "Cache-Control": "no-store", "Set-Cookie": clearPending } });
  if (!stateCookie || !verifier || !returnedState || !safeEqual(stateCookie, returnedState) || !code) {
    return new Response(null, { status: 302, headers: { Location: `${APP_ORIGIN}/?deriv_oauth=failed`, "Cache-Control": "no-store", "Set-Cookie": clearPending } });
  }
  if (!clientId || !redirectUri || secret.length < 32) {
    return new Response(null, { status: 302, headers: { Location: `${APP_ORIGIN}/?deriv_oauth=misconfigured`, "Cache-Control": "no-store", "Set-Cookie": clearPending } });
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
    if (!response.ok) throw new Error("Deriv token exchange failed.");
    const token = await response.json() as { access_token?: unknown; expires_in?: unknown; token_type?: unknown };
    if (typeof token.access_token !== "string" || !token.access_token || (token.token_type && token.token_type !== "Bearer")) throw new Error("Deriv returned an invalid token response.");
    const expiresIn = typeof token.expires_in === "number" && Number.isFinite(token.expires_in) ? Math.max(60, Math.min(token.expires_in, 3600)) : 3600;
    const expiresAt = Date.now() + expiresIn * 1000;
    const encrypted = encryptSession({ accessToken: token.access_token, expiresAt }, secret);
    if (encrypted.length > 3500) throw new Error("Encrypted session exceeds the safe cookie size.");
    // Validate that the generated cookie can be read before issuing it.
    if (!decryptSession(encrypted, secret)) throw new Error("Could not validate the encrypted session.");
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${APP_ORIGIN}/?view=account&deriv_oauth=connected`,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Set-Cookie": [clearCookie(OAUTH_STATE_COOKIE), clearCookie(OAUTH_VERIFIER_COOKIE), cookie(OAUTH_COOKIE, encrypted, expiresIn)].join(", "),
      },
    });
  } catch {
    return new Response(null, { status: 302, headers: { Location: `${APP_ORIGIN}/?view=account&deriv_oauth=failed`, "Cache-Control": "no-store", "Set-Cookie": clearPending } });
  }
}

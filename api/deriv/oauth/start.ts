import { createHash } from "node:crypto";
import { cookie, OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, randomUrlSafe } from "../../../shared/oauth-session.js";

const AUTH_URL = "https://auth.deriv.com/oauth2/auth";

export async function GET(): Promise<Response> {
  const clientId = process.env.DERIV_OAUTH_CLIENT_ID?.trim();
  const redirectUri = process.env.DERIV_OAUTH_REDIRECT_URI?.trim();
  const sessionSecret = process.env.SESSION_SECRET ?? "";
  if (!clientId || !/^\d+$/.test(clientId) || !redirectUri || !sessionSecret || sessionSecret.length < 32) {
    return Response.json({ error: "OAuth is not configured. Set DERIV_OAUTH_CLIENT_ID, DERIV_OAUTH_REDIRECT_URI, and a SESSION_SECRET of at least 32 characters." }, { status: 503 });
  }
  let redirect: URL;
  try { redirect = new URL(redirectUri); } catch { return Response.json({ error: "DERIV_OAUTH_REDIRECT_URI is invalid." }, { status: 503 }); }
  if (redirect.protocol !== "https:" || redirect.hostname !== "butcher-trader-lemon.vercel.app" || redirect.pathname !== "/deriv/callback") {
    return Response.json({ error: "The OAuth redirect URI must be the registered HTTPS production callback URL." }, { status: 503 });
  }

  const state = randomUrlSafe(32);
  const verifier = randomUrlSafe(48);
  const challenge = createHash("sha256").update(verifier, "utf8").digest("base64url");
  const authorization = new URL(AUTH_URL);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("client_id", clientId);
  authorization.searchParams.set("redirect_uri", redirectUri);
  authorization.searchParams.set("scope", "trade");
  authorization.searchParams.set("state", state);
  authorization.searchParams.set("code_challenge", challenge);
  authorization.searchParams.set("code_challenge_method", "S256");

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorization.toString(),
      "Cache-Control": "no-store",
      "Set-Cookie": [
        cookie(OAUTH_STATE_COOKIE, state, 600),
        cookie(OAUTH_VERIFIER_COOKIE, verifier, 600),
      ].join(", "),
    },
  });
}

import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { cookie, OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, randomUrlSafe } from "../../../shared/oauth-session.js";

const AUTH_URL = "https://auth.deriv.com/oauth2/auth";
const APP_HOST = "butcherfx.vercel.app";

export default function handler(_req: IncomingMessage, res: ServerResponse): void {
  const clientId = process.env.DERIV_OAUTH_CLIENT_ID?.trim();
  const redirectUri = process.env.DERIV_OAUTH_REDIRECT_URI?.trim();
  const sessionSecret = process.env.SESSION_SECRET ?? "";
  if (!clientId || !/^\\d+$/.test(clientId) || !redirectUri || !sessionSecret || sessionSecret.length < 32) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "OAuth is not configured. Set DERIV_OAUTH_CLIENT_ID, DERIV_OAUTH_REDIRECT_URI, and a SESSION_SECRET of at least 32 characters." }));
    return;
  }
  let redirect: URL;
  try { redirect = new URL(redirectUri); } catch {
    res.statusCode = 503; res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "DERIV_OAUTH_REDIRECT_URI is invalid." })); return;
  }
  if (redirect.protocol !== "https:" || redirect.hostname !== APP_HOST || redirect.pathname !== "/deriv/callback" || redirect.search || redirect.hash) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "DERIV_OAUTH_REDIRECT_URI must exactly match the registered HTTPS callback URL." }));
    return;
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

  res.statusCode = 302;
  res.setHeader("Location", authorization.toString());
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Set-Cookie", [
    cookie(OAUTH_STATE_COOKIE, state, 600),
    cookie(OAUTH_VERIFIER_COOKIE, verifier, 600),
  ]);
  res.end();
}

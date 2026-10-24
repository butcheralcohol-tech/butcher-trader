import type { IncomingMessage, ServerResponse } from "node:http";
import { OAUTH_COOKIE, decryptSession, parseCookies } from "../../shared/oauth-session.js";

type DerivAccount = {
  account_id?: string;
  account_type?: string;
  is_virtual?: number;
  currency?: string;
  balance?: number;
};

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");

  const secret = process.env.SESSION_SECRET ?? "";
  const configured = Boolean(
    process.env.DERIV_OAUTH_CLIENT_ID?.trim() &&
      process.env.DERIV_OAUTH_REDIRECT_URI?.trim() &&
      secret.length >= 32,
  );

  if (!configured) {
    res.end(JSON.stringify({ connected: false, configured: false, expiresAt: null, accounts: [] }));
    return;
  }

  const cookies = parseCookies(typeof req.headers.cookie === "string" ? req.headers.cookie : null);
  const session = decryptSession(cookies[OAUTH_COOKIE], secret);

  if (!session) {
    res.end(JSON.stringify({ connected: false, configured: true, expiresAt: null, accounts: [] }));
    return;
  }

  // The session cookie only stores the access token and expiry — it does not
  // contain the account ID. Discover accounts from Deriv's REST endpoint.
  let accounts: DerivAccount[] = [];
  let accountError: string | null = null;

  try {
    const appId = process.env.DERIV_APP_ID?.trim();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.accessToken}`,
      Accept: "application/json",
    };
    // PAT authentication requires Deriv-App-ID; OAuth tokens do not, but
    // sending it is harmless when the token type is OAuth.
    if (appId && /^\d+$/.test(appId)) {
      headers["Deriv-App-ID"] = appId;
    }

    const response = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const body = await response.text();
      accountError = `Deriv accounts request rejected (${response.status}). ${body.slice(0, 200)}`;
    } else {
      const payload = (await response.json()) as { data?: DerivAccount[] };
      if (Array.isArray(payload.data)) {
        accounts = payload.data;
      }
    }
  } catch {
    accountError = "Deriv accounts request unavailable.";
  }

  res.end(
    JSON.stringify({
      connected: true,
      configured: true,
      expiresAt: session.expiresAt ?? null,
      accounts,
      accountError,
    }),
  );
}

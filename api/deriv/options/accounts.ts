import type { IncomingMessage, ServerResponse } from "node:http";
import { OAUTH_COOKIE, decryptSession, parseCookies } from "../../shared/oauth-session.js";
import { getDerivOptionsAccounts } from "../../shared/deriv-options-otp.js";

function respond(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); respond(res, 405, { error: "Method not allowed." }); return; }
  const session = decryptSession(
    parseCookies(typeof req.headers.cookie === "string" ? req.headers.cookie : null)[OAUTH_COOKIE],
    process.env.SESSION_SECRET ?? "",
  );
  if (!session) { respond(res, 401, { error: "Connect Deriv before selecting a trading account." }); return; }
  try {
    const accounts = await getDerivOptionsAccounts(session.accessToken);
    respond(res, 200, { accounts: accounts.map(({ account_id, account_type, currency, status, balance }) =>
      ({ accountId: account_id, accountType: account_type, currency, ...(status ? { status } : {}),
        ...(typeof balance === "number" && Number.isFinite(balance) ? { balance } : {}) })) });
  } catch (error) {
    respond(res, 503, { error: error instanceof Error ? error.message : "Deriv account lookup failed." });
  }
}

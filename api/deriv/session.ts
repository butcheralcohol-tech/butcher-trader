import { OAUTH_COOKIE, decryptSession, parseCookies } from "../../shared/oauth-session.js";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.SESSION_SECRET ?? "";
  const configured = Boolean(
    process.env.DERIV_OAUTH_CLIENT_ID?.trim() &&
    process.env.DERIV_OAUTH_REDIRECT_URI?.trim() &&
    secret.length >= 32
  );
  if (!configured) return Response.json({ connected: false, configured: false }, { headers: { "Cache-Control": "no-store" } });
  const cookies = parseCookies(request.headers.get("cookie"));
  const session = decryptSession(cookies[OAUTH_COOKIE], secret);
  return Response.json({
    connected: Boolean(session),
    configured: true,
    expiresAt: session?.expiresAt ?? null,
  }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

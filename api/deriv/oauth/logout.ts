import { clearCookie, OAUTH_COOKIE } from "../../../shared/oauth-session.js";

export async function POST(): Promise<Response> {
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", clearCookie(OAUTH_COOKIE));
  return Response.json({ ok: true, connected: false }, { headers });
}

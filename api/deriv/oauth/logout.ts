import { clearCookie, OAUTH_COOKIE } from "../../../shared/oauth-session.js";

export async function POST(): Promise<Response> {
  return Response.json({ ok: true, connected: false }, {
    headers: { "Cache-Control": "no-store", "Set-Cookie": clearCookie(OAUTH_COOKIE) },
  });
}

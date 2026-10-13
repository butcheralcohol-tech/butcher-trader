import type { IncomingMessage, ServerResponse } from "node:http";
import { clearCookie, OAUTH_COOKIE } from "../../../shared/oauth-session.js";

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Set-Cookie", clearCookie(OAUTH_COOKIE));
  res.end(JSON.stringify({ ok: true, connected: false }));
}

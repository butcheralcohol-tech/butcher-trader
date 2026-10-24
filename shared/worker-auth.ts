import { createHash, timingSafeEqual } from "node:crypto";

export type WorkerSession = { accessToken: string; expiresAt: number; worker: true };

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Service credential for the always-on worker, which has no browser cookie.
 * Requires BOTH a strong shared secret (>= 32 chars) and a Deriv token configured server-side.
 * The request still goes through every gate in api/deriv/trade.ts (risk, locks, real-money gate, kill switches).
 */
export function workerSession(authorization: string | undefined, env: Record<string, string | undefined>): WorkerSession | null {
  const secret = env.WORKER_SECRET ?? "";
  const token = env.DERIV_WORKER_TOKEN ?? "";
  if (secret.length < 32 || !token) return null;
  const match = /^Bearer (.+)$/.exec(authorization ?? "");
  if (!match) return null;
  if (!timingSafeEqual(digest(match[1]), digest(secret))) return null;
  return { accessToken: token, expiresAt: Date.now() + 60_000, worker: true };
}

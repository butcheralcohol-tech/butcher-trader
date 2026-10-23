import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { DerivOptionsClient } from "./deriv-options.js";

/**
 * Persistent Railway process entrypoint.
 *
 * This process deliberately refuses to place orders until the repository has a verified
 * Options API proposal/buy/settlement lifecycle and durable reconciliation implementation.
 * It can validate deployment wiring and maintain a broker-authenticated demo session, but
 * is not an autonomous trading loop. This prevents a worker deployment from silently
 * turning into an unbounded order generator.
 */
const sleepMs = 15_000;
const env = (key: string) => process.env[key]?.trim() ?? "";

async function main(): Promise<void> {
  if (env("WORKER_MODE") !== "demo") throw new Error("WORKER_MODE must explicitly be demo; worker stopped.");
  if (env("WORKER_ENABLE_ORDERS") !== "false") throw new Error("WORKER_ENABLE_ORDERS must be false until the full order lifecycle is verified.");
  const accountId = env("DERIV_DEMO_ACCOUNT_ID");
  const accessToken = env("DERIV_ACCESS_TOKEN");
  const redisUrl = env("UPSTASH_REDIS_REST_URL");
  const redisToken = env("UPSTASH_REDIS_REST_TOKEN");
  if (!/^VRTC\d+$/.test(accountId)) throw new Error("DERIV_DEMO_ACCOUNT_ID must be a selected Deriv VRTC demo account.");
  if (!accessToken) throw new Error("DERIV_ACCESS_TOKEN is missing; no browser/client token fallback is allowed.");
  if (!redisUrl || !redisToken) throw new Error("Durable Upstash storage is required; worker stopped.");
  const appId = env("DERIV_APP_ID");
  let client: DerivOptionsClient | undefined;
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    client = await DerivOptionsClient.connect({ accessToken, accountId, ...(appId ? { appId } : {}) });
    console.log(JSON.stringify({ event: "demo_options_session_connected", accountId, ordersEnabled: false, liveTradingEnabled: false }));
    // Stay resident and report liveness. No orders are submitted by this scaffold.
    while (!stopping) {
      const response = await fetch(redisUrl.replace(/\/$/, ""), {
        method: "POST",
        headers: { Authorization: `Bearer ${redisToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(["SET", `butcher:worker:${accountId}:heartbeat`, JSON.stringify({ at: new Date().toISOString(), mode: "demo", ordersEnabled: false }), "EX", 60]),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Durable heartbeat storage unavailable; worker stopped.");
      const result = await response.json() as { error?: string };
      if (result.error) throw new Error("Durable heartbeat write failed; worker stopped.");
      await delay(sleepMs);
    }
  } finally {
    await client?.close().catch(() => undefined);
  }
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : "Worker failed closed.");
  process.exitCode = 1;
});

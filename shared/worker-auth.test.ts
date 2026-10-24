import test from "node:test";
import assert from "node:assert/strict";
import { workerSession } from "./worker-auth.js";

const SECRET = "s".repeat(40);
const env = { WORKER_SECRET: SECRET, DERIV_WORKER_TOKEN: "tok" };

test("accepts the exact secret and returns the server-side token", () => {
  assert.equal(workerSession(`Bearer ${SECRET}`, env)?.accessToken, "tok");
});
test("rejects wrong, missing or malformed credentials", () => {
  for (const h of [undefined, "", "Bearer nope", `Basic ${SECRET}`, `bearer ${SECRET}`, `Bearer ${SECRET} `, `Bearer ${SECRET}x`]) assert.equal(workerSession(h, env), null, String(h));
});
test("disabled unless a strong secret AND a token are configured", () => {
  assert.equal(workerSession("Bearer short", { WORKER_SECRET: "short", DERIV_WORKER_TOKEN: "tok" }), null);
  assert.equal(workerSession(`Bearer ${SECRET}`, { WORKER_SECRET: SECRET }), null);
  assert.equal(workerSession(`Bearer ${SECRET}`, {}), null);
});

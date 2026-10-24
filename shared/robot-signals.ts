import type { AuditEvent } from "./sim.js";

export type RobotOrder = { time: number; contractType: "CALL" | "PUT"; idempotencyKey: string };

/** Newly filled paper entries after `afterTime`, as broker order requests.
 *  Tracking by candle time (not by array position) keeps this correct when the audit log is trimmed, and the
 *  deterministic key lets the server reject a duplicate if the page reloads or the same fill is seen twice. */
export function newRobotOrders(events: AuditEvent[], afterTime: number, sessionStartedAt: number, symbol: string): RobotOrder[] {
  const seen = new Set<number>();
  const out: RobotOrder[] = [];
  for (const e of events) {
    if (e.type !== "FILLED" || e.time <= afterTime || seen.has(e.time)) continue;
    const contractType = /\bPAPER LONG\b/.test(e.message) ? "CALL" : /\bPAPER SHORT\b/.test(e.message) ? "PUT" : null;
    if (!contractType) continue;
    seen.add(e.time);
    out.push({ time: e.time, contractType, idempotencyKey: `robot_${sessionStartedAt}_${symbol}_${e.time}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) });
  }
  return out;
}

export const latestEventTime = (events: AuditEvent[]): number => events.reduce((m, e) => Math.max(m, e.time), 0);

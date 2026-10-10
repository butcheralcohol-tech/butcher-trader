import type { Candle } from "./types.js";

export const GRANULARITIES = [
  { seconds: 60, label: "1m" }, { seconds: 300, label: "5m" }, { seconds: 900, label: "15m" },
  { seconds: 3600, label: "1h" }, { seconds: 14400, label: "4h" },
] as const;

const finite = (...n: unknown[]) => n.every(v => typeof v === "number" && Number.isFinite(v));
const toCandle = (o: Record<string, unknown>, time: unknown): Candle | null => {
  const c = { time: Number(time), open: Number(o.open), high: Number(o.high), low: Number(o.low), close: Number(o.close) };
  return finite(c.time, c.open, c.high, c.low, c.close) && c.high >= c.low ? c : null;
};

/** Deriv `ticks_history` (style: candles) response → sorted, de-duplicated candles. Bad rows are dropped. */
export function parseHistory(msg: unknown): Candle[] {
  const list = (msg as { candles?: unknown })?.candles;
  if (!Array.isArray(list)) return [];
  const byTime = new Map<number, Candle>();
  for (const item of list) {
    const c = item && typeof item === "object" ? toCandle(item as Record<string, unknown>, (item as Record<string, unknown>).epoch) : null;
    if (c) byTime.set(c.time, c);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Deriv streaming `ohlc` message → one candle keyed by its open time. */
export function parseOhlc(msg: unknown): Candle | null {
  const o = (msg as { ohlc?: unknown })?.ohlc;
  return o && typeof o === "object" ? toCandle(o as Record<string, unknown>, (o as Record<string, unknown>).open_time) : null;
}

/** Immutable merge: replace the forming candle, append a new one, ignore anything older than the last candle unless it replaces a known one. */
export function mergeCandle(list: Candle[], c: Candle, max = 5000): Candle[] {
  const last = list[list.length - 1];
  let next: Candle[];
  if (!last || c.time > last.time) next = [...list, c];
  else if (c.time === last.time) next = [...list.slice(0, -1), c];
  else {
    const i = list.findIndex(x => x.time === c.time);
    if (i < 0) return list;
    next = list.slice(); next[i] = c;
  }
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Exponential backoff with jitter: ~1s, 2s, 4s … capped at 30s. `rand` is injectable for tests. */
export function backoffDelay(attempt: number, rand = Math.random): number {
  return Math.round(Math.min(30000, 1000 * 2 ** Math.max(0, attempt)) * (0.5 + rand() * 0.5));
}

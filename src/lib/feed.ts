import { backoffDelay, mergeCandle, parseHistory, parseOhlc } from "../../shared/candles.js";
import type { Candle } from "../../shared/types.js";

export type FeedStatus = "CONNECTING" | "LIVE" | "RECONNECTING" | "ERROR" | "STOPPED";
export type FeedInfo = { status: FeedStatus; message: string; attempt: number; lastDataAt: number | null };
type SocketLike = Pick<WebSocket, "send" | "close" | "readyState"> & { onopen: ((e: Event) => void) | null; onmessage: ((e: MessageEvent) => void) | null; onerror: ((e: Event) => void) | null; onclose: ((e: CloseEvent) => void) | null };

/** Deriv's new public (no-auth) market-data socket, then the legacy socket as a fallback. Set VITE_DERIV_WS_URL to force a single endpoint. */
export const DERIV_WS_PUBLIC = "wss://api.derivws.com/trading/v1/options/ws/public";
export const DERIV_WS_LEGACY = "wss://ws.derivws.com/websockets/v3";
export const defaultAppId = () => String(import.meta.env?.VITE_DERIV_APP_ID || "1089");
export const defaultEndpoints = (): string[] => {
  const forced = String(import.meta.env?.VITE_DERIV_WS_URL || "").trim();
  return forced ? [forced] : [DERIV_WS_PUBLIC, DERIV_WS_LEGACY];
};
/** The legacy socket needs an app_id query parameter; the new public socket does not. */
export const wsUrl = (endpoint: string, appId: string) => endpoint.includes("ws.derivws.com") ? `${endpoint}?app_id=${encodeURIComponent(appId)}` : endpoint;

export type FeedOptions = {
  symbol: string; granularity: number; count?: number; appId?: string; endpoints?: string[];
  onCandles: (candles: Candle[]) => void; onInfo: (info: FeedInfo) => void;
  staleMs?: number; wsFactory?: (url: string) => SocketLike;
};

/** Read-only Deriv candle feed: history + streaming OHLC, automatic reconnect with backoff, stale-connection watchdog and keep-alive pings. Never places orders. */
export class DerivFeed {
  private socket: SocketLike | null = null;
  private candles: Candle[] = [];
  private attempt = 0;
  private endpointIdx = 0;
  private stopped = true;
  private lastMessageAt = 0;
  private lastDataAt: number | null = null;
  private timers: { retry?: ReturnType<typeof setTimeout>; watchdog?: ReturnType<typeof setInterval>; ping?: ReturnType<typeof setInterval> } = {};
  constructor(private o: FeedOptions) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false; this.attempt = 0;
    this.timers.watchdog = setInterval(() => this.check(), 5000);
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timers.retry); clearInterval(this.timers.watchdog); clearInterval(this.timers.ping);
    this.detach();
    this.info("STOPPED", "Feed stopped.");
  }

  private info(status: FeedStatus, message: string) { this.o.onInfo({ status, message, attempt: this.attempt, lastDataAt: this.lastDataAt }); }

  private detach() {
    const s = this.socket; this.socket = null;
    if (s) { s.onopen = s.onmessage = s.onerror = s.onclose = null; try { s.close(); } catch { /* already closed */ } }
  }

  private connect() {
    if (this.stopped) return;
    this.detach();
    this.info(this.attempt === 0 ? "CONNECTING" : "RECONNECTING", this.attempt === 0 ? "Connecting to Deriv…" : `Reconnecting (attempt ${this.attempt})…`);
    let socket: SocketLike;
    try { socket = (this.o.wsFactory ?? (u => new WebSocket(u)))(wsUrl(this.endpoints()[this.endpointIdx % this.endpoints().length], this.o.appId ?? defaultAppId())); }
    catch { return this.scheduleRetry("Could not open a WebSocket."); }
    this.socket = socket; this.lastMessageAt = Date.now();
    socket.onopen = () => {
      if (this.socket !== socket) return;
      // Re-requesting history on every (re)connect back-fills any candles missed while offline.
      socket.send(JSON.stringify({ ticks_history: this.o.symbol, adjust_start_time: 1, count: this.o.count ?? 500, end: "latest", style: "candles", granularity: this.o.granularity, subscribe: 1 }));
      clearInterval(this.timers.ping);
      this.timers.ping = setInterval(() => { try { socket.send(JSON.stringify({ ping: 1 })); } catch { /* watchdog will recover */ } }, 25000);
    };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      this.lastMessageAt = Date.now();
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      if (msg.error) { const e = msg.error as { message?: string }; return this.fail(e.message ?? "Feed error"); }
      if (msg.msg_type === "candles") {
        const history = parseHistory(msg);
        if (!history.length) return this.fail("No candle history returned (market may be closed).");
        this.candles = history; this.markData(); this.attempt = 0;
        this.o.onCandles(this.candles); this.info("LIVE", "Live feed connected.");
      } else if (msg.msg_type === "ohlc") {
        const c = parseOhlc(msg);
        if (c) { this.candles = mergeCandle(this.candles, c, this.o.count ?? 500); this.markData(); this.o.onCandles(this.candles); this.info("LIVE", "Live feed connected."); }
      }
    };
    socket.onerror = () => { if (this.socket === socket) this.scheduleRetry("Connection error."); };
    socket.onclose = () => { if (this.socket === socket) this.scheduleRetry("Connection closed."); };
  }

  private endpoints() { const e = this.o.endpoints ?? defaultEndpoints(); return e.length ? e : [DERIV_WS_PUBLIC]; }

  private markData() { this.lastDataAt = Date.now(); }

  private fail(message: string) { this.detach(); this.scheduleRetry(message); }

  private scheduleRetry(message: string) {
    if (this.stopped || this.timers.retry) return;
    this.detach(); clearInterval(this.timers.ping);
    if (this.endpoints().length > 1) this.endpointIdx = (this.endpointIdx + 1) % this.endpoints().length;
    const delay = backoffDelay(this.attempt++);
    this.info("ERROR", `${message} Retrying in ${Math.round(delay / 1000)}s.`);
    this.timers.retry = setTimeout(() => { this.timers.retry = undefined; this.connect(); }, delay);
  }

  /** Pings keep an idle-but-healthy socket alive. No message at all for `staleMs` means the link is dead even if the browser has not noticed. */
  private check() {
    if (this.stopped || this.timers.retry || !this.socket) return;
    if (Date.now() - this.lastMessageAt > (this.o.staleMs ?? 60000)) this.scheduleRetry("Feed went silent.");
  }
}

/** One-shot history download (up to 5000 candles) for backtesting. Tries each endpoint in turn. */
export async function fetchCandles(symbol: string, granularity: number, count: number, appId = defaultAppId(), timeoutMs = 20000, endpoints = defaultEndpoints()): Promise<Candle[]> {
  let lastError = new Error("Could not reach Deriv.");
  for (const endpoint of endpoints) {
    try { return await fetchFrom(wsUrl(endpoint, appId), symbol, granularity, count, timeoutMs); }
    catch (e) { lastError = e instanceof Error ? e : lastError; }
  }
  throw lastError;
}

function fetchFrom(url: string, symbol: string, granularity: number, count: number, timeoutMs: number): Promise<Candle[]> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const done = (fn: () => void) => { clearTimeout(timer); socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null; try { socket.close(); } catch { /* noop */ } fn(); };
    const timer = setTimeout(() => done(() => reject(new Error("Timed out loading history."))), timeoutMs);
    socket.onopen = () => socket.send(JSON.stringify({ ticks_history: symbol, adjust_start_time: 1, count: Math.min(5000, count), end: "latest", style: "candles", granularity }));
    socket.onerror = () => done(() => reject(new Error("Could not reach Deriv.")));
    socket.onclose = () => done(() => reject(new Error("Deriv closed the connection.")));
    socket.onmessage = event => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      if (msg.error) return done(() => reject(new Error((msg.error as { message?: string }).message ?? "Deriv returned an error.")));
      if (msg.msg_type === "candles") { const c = parseHistory(msg); done(() => (c.length ? resolve(c) : reject(new Error("No history returned for this market.")))); }
    };
  });
}

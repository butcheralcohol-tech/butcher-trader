import { backoffDelay, mergeCandle, parseHistory, parseOhlc } from "../../shared/candles.js";
import type { Candle } from "../../shared/types.js";

export type FeedStatus = "CONNECTING" | "LIVE" | "RECONNECTING" | "ERROR" | "STOPPED";
export type FeedInfo = { status: FeedStatus; message: string; attempt: number; lastDataAt: number | null };
type SocketLike = Pick<WebSocket, "send" | "close" | "readyState"> & { onopen: ((e: Event) => void) | null; onmessage: ((e: MessageEvent) => void) | null; onerror: ((e: Event) => void) | null; onclose: ((e: CloseEvent) => void) | null };

export const DERIV_WS = "wss://ws.derivws.com/websockets/v3";
const wsUrl = (appId: string) => `${DERIV_WS}?app_id=${encodeURIComponent(appId)}`;
export const defaultAppId = () => String(import.meta.env.VITE_DERIV_APP_ID || "1089");

export type FeedOptions = {
  symbol: string; granularity: number; count?: number; appId?: string;
  onCandles: (candles: Candle[]) => void; onInfo: (info: FeedInfo) => void;
  staleMs?: number; connectTimeoutMs?: number; responseTimeoutMs?: number; wsFactory?: (url: string) => SocketLike;
};

/** Read-only Deriv candle feed: history + streaming OHLC, automatic reconnect with backoff, stale-connection watchdog and keep-alive pings. Never places orders. */
export class DerivFeed {
  private socket: SocketLike | null = null;
  private candles: Candle[] = [];
  private attempt = 0;
  private stopped = true;
  private lastMessageAt = 0;
  private lastDataAt: number | null = null;
  private timers: { retry?: ReturnType<typeof setTimeout>; connect?: ReturnType<typeof setTimeout>; response?: ReturnType<typeof setTimeout>; watchdog?: ReturnType<typeof setInterval>; ping?: ReturnType<typeof setInterval> } = {};
  constructor(private o: FeedOptions) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false; this.attempt = 0;
    this.timers.watchdog = setInterval(() => this.check(), 5000);
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timers.retry); clearTimeout(this.timers.connect); clearTimeout(this.timers.response); clearInterval(this.timers.watchdog); clearInterval(this.timers.ping);
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
    try { socket = (this.o.wsFactory ?? (u => new WebSocket(u)))(wsUrl(this.o.appId ?? defaultAppId())); }
    catch { return this.scheduleRetry("Could not open a WebSocket."); }
    this.socket = socket; this.lastMessageAt = Date.now();
    this.timers.connect = setTimeout(() => {
      if (this.socket === socket) this.scheduleRetry("Timed out opening the Deriv WebSocket. Check network access and the configured Deriv app ID.");
    }, this.o.connectTimeoutMs ?? 12000);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      clearTimeout(this.timers.connect); this.timers.connect = undefined;
      this.info("CONNECTING", "WebSocket open; requesting candle history…");
      // Re-requesting history on every (re)connect back-fills any candles missed while offline.
      socket.send(JSON.stringify({ ticks_history: this.o.symbol, adjust_start_time: 1, count: this.o.count ?? 500, end: "latest", style: "candles", granularity: this.o.granularity, subscribe: 1 }));
      clearTimeout(this.timers.response);
      this.timers.response = setTimeout(() => {
        if (this.socket === socket && this.lastDataAt === null) this.scheduleRetry("Connected to Deriv, but no candle data arrived. Verify the app ID and market symbol.");
      }, this.o.responseTimeoutMs ?? 15000);
      clearInterval(this.timers.ping);
      this.timers.ping = setInterval(() => { try { socket.send(JSON.stringify({ ping: 1 })); } catch { /* watchdog will recover */ } }, 25000);
    };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      this.lastMessageAt = Date.now();
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      if (msg.error) { const e = msg.error as { message?: string; code?: string }; return this.fail(`Deriv API error${e.code ? ` (${e.code})` : ""}: ${e.message ?? "Feed error"}`); }
      if (msg.msg_type === "candles") {
        clearTimeout(this.timers.response); this.timers.response = undefined;
        const history = parseHistory(msg);
        if (!history.length) return this.fail("No candle history returned (market may be closed).");
        this.candles = history; this.markData(); this.attempt = 0;
        this.o.onCandles(this.candles); this.info("LIVE", "Live feed connected.");
      } else if (msg.msg_type === "ohlc") {
        clearTimeout(this.timers.response); this.timers.response = undefined;
        const c = parseOhlc(msg);
        if (c) { this.candles = mergeCandle(this.candles, c, this.o.count ?? 500); this.markData(); this.o.onCandles(this.candles); this.info("LIVE", "Live feed connected."); }
      }
    };
    socket.onerror = () => { if (this.socket === socket) this.scheduleRetry("Connection error."); };
    socket.onclose = () => { if (this.socket === socket) this.scheduleRetry("Connection closed."); };
  }

  private markData() { this.lastDataAt = Date.now(); }

  private fail(message: string) { this.detach(); this.scheduleRetry(message); }

  private scheduleRetry(message: string) {
    if (this.stopped || this.timers.retry) return;
    clearTimeout(this.timers.connect); this.timers.connect = undefined;
    clearTimeout(this.timers.response); this.timers.response = undefined;
    this.detach(); clearInterval(this.timers.ping);
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

/** One-shot history download (up to 5000 candles) for backtesting. */
export function fetchCandles(symbol: string, granularity: number, count: number, appId = defaultAppId(), timeoutMs = 20000): Promise<Candle[]> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl(appId));
    const done = (fn: () => void) => { clearTimeout(timer); socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null; try { socket.close(); } catch { /* noop */ } fn(); };
    const timer = setTimeout(() => done(() => reject(new Error("Timed out loading history."))), timeoutMs);
    socket.onopen = () => socket.send(JSON.stringify({ ticks_history: symbol, adjust_start_time: 1, count: Math.min(5000, count), end: "latest", style: "candles", granularity }));
    socket.onerror = () => done(() => reject(new Error("Could not reach Deriv.")));
    socket.onmessage = event => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      if (msg.error) return done(() => reject(new Error((msg.error as { message?: string }).message ?? "Deriv returned an error.")));
      if (msg.msg_type === "candles") { const c = parseHistory(msg); done(() => (c.length ? resolve(c) : reject(new Error("No history returned for this market.")))); }
    };
  });
}

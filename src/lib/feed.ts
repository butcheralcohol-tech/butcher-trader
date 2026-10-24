import { backoffDelay, mergeCandle, parseHistory, parseOhlc } from "../../shared/candles.js";
import type { Candle } from "../../shared/types.js";

export type FeedStatus = "CONNECTING" | "LIVE" | "RECONNECTING" | "ERROR" | "STOPPED";
export type FeedInfo = {
  status: FeedStatus;
  message: string;
  attempt: number;
  lastDataAt: number | null;
};
type SocketLike = Pick<WebSocket, "send" | "close" | "readyState"> & {
  onopen: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onclose: ((e: CloseEvent) => void) | null;
};

export const DERIV_WS = "wss://api.derivws.com/trading/v1/options/ws/public";
export const DERIV_WS_LEGACY = "wss://ws.derivws.com/websockets/v3";
export const DERIV_WS_FALLBACK = "wss://ws.binaryws.com/websockets/v3";
// Prefer Deriv's newer unauthenticated public market-data WebSocket. The legacy
// endpoints remain fallbacks; public market-data calls do not require OAuth.
const wsUrl = (appId: string, attempt = 0) => {
  const endpoints = [DERIV_WS, DERIV_WS_LEGACY, DERIV_WS_FALLBACK];
  const endpoint = endpoints[attempt % endpoints.length];
  return endpoint === DERIV_WS ? endpoint : `${endpoint}?app_id=${encodeURIComponent(appId)}`;
};
export const defaultAppId = () => String(import.meta.env.VITE_DERIV_APP_ID || "1089");

export type FeedOptions = {
  symbol: string;
  granularity: number;
  count?: number;
  appId?: string;
  onCandles: (candles: Candle[]) => void;
  onInfo: (info: FeedInfo) => void;
  staleMs?: number;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
  wsFactory?: (url: string) => SocketLike;
};

/** Read-only Deriv candle feed: history + streaming OHLC, automatic reconnect with backoff, explicit connection/history timeouts and keep-alive pings. Never places orders. */
export class DerivFeed {
  private socket: SocketLike | null = null;
  private candles: Candle[] = [];
  private attempt = 0;
  private stopped = true;
  private historyReceived = false;
  private lastMessageAt = 0;
  private lastDataAt: number | null = null;
  private timers: {
    retry?: ReturnType<typeof setTimeout>;
    watchdog?: ReturnType<typeof setInterval>;
    ping?: ReturnType<typeof setInterval>;
    connectTimeout?: ReturnType<typeof setTimeout>;
    responseTimeout?: ReturnType<typeof setTimeout>;
  } = {};

  constructor(private o: FeedOptions) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.timers.watchdog = setInterval(() => this.check(), 5000);
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timers.retry);
    clearInterval(this.timers.watchdog);
    clearInterval(this.timers.ping);
    clearTimeout(this.timers.connectTimeout);
    clearTimeout(this.timers.responseTimeout);
    this.detach();
    this.info("STOPPED", "Feed stopped.");
  }

  private info(status: FeedStatus, message: string) {
    this.o.onInfo({ status, message, attempt: this.attempt, lastDataAt: this.lastDataAt });
  }

  private detach() {
    clearTimeout(this.timers.connectTimeout);
    this.timers.connectTimeout = undefined;
    clearTimeout(this.timers.responseTimeout);
    this.timers.responseTimeout = undefined;
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onopen = s.onmessage = s.onerror = s.onclose = null;
      try {
        s.close();
      } catch {
        /* already closed */
      }
    }
  }

  private connect() {
    if (this.stopped) return;
    this.detach();
    this.historyReceived = false;
    this.info(
      this.attempt === 0 ? "CONNECTING" : "RECONNECTING",
      this.attempt === 0
        ? "Opening Deriv market-data connection…"
        : `Reconnecting (attempt ${this.attempt})…`,
    );
    let socket: SocketLike;
    try {
      socket = (this.o.wsFactory ?? ((u) => new WebSocket(u)))(
        wsUrl(this.o.appId ?? defaultAppId(), this.attempt),
      );
    } catch {
      return this.scheduleRetry(
        "Could not create the Deriv WebSocket. Check browser support and the configured app ID.",
      );
    }
    this.socket = socket;
    this.lastMessageAt = Date.now();
    socket.onopen = () => {
      if (this.socket !== socket) return;
      clearTimeout(this.timers.connectTimeout);
      this.timers.connectTimeout = undefined;
      // A successful TCP/WebSocket handshake is not enough: require a candle-history response.
      this.timers.responseTimeout = setTimeout(() => {
        if (this.socket === socket && !this.historyReceived) {
          this.scheduleRetry(
            "Connected to Deriv, but candle history did not arrive in time. Check VITE_DERIV_APP_ID, the selected symbol, and browser network restrictions.",
          );
        }
      }, this.o.responseTimeoutMs ?? 15000);
      try {
        socket.send(
          JSON.stringify({
            ticks_history: this.o.symbol,
            adjust_start_time: 1,
            count: this.o.count ?? 500,
            end: "latest",
            style: "candles",
            granularity: this.o.granularity,
            subscribe: 1,
          }),
        );
        clearInterval(this.timers.ping);
        this.timers.ping = setInterval(() => {
          try {
            socket.send(JSON.stringify({ ping: 1 }));
          } catch {
            /* watchdog will recover */
          }
        }, 25000);
      } catch {
        this.scheduleRetry("Deriv WebSocket opened, but the candle request could not be sent.");
      }
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.lastMessageAt = Date.now();
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.error) {
        const e = msg.error as { message?: string; code?: string };
        return this.fail(
          `Deriv API error${e.code ? ` (${e.code})` : ""}: ${e.message ?? "Unknown feed error"}`,
        );
      }
      if (msg.msg_type === "candles") {
        const history = parseHistory(msg);
        if (!history.length) {
          return this.fail("Deriv responded, but returned no valid candles for this symbol/timeframe.");
        }
        clearTimeout(this.timers.responseTimeout);
        this.timers.responseTimeout = undefined;
        this.historyReceived = true;
        this.candles = history;
        this.markData();
        this.attempt = 0;
        this.o.onCandles(this.candles);
        this.info("LIVE", "Live market feed connected; candle history loaded.");
      } else if (msg.msg_type === "ohlc") {
        const c = parseOhlc(msg);
        if (c) {
          this.candles = mergeCandle(this.candles, c, this.o.count ?? 500);
          this.markData();
          this.o.onCandles(this.candles);
          if (this.historyReceived) this.info("LIVE", "Live market feed connected.");
        }
      }
    };
    socket.onerror = () => {
      if (this.socket === socket) {
        this.scheduleRetry(
          "WebSocket network error. Check connectivity, firewall/content blockers, and VITE_DERIV_APP_ID.",
        );
      }
    };
    socket.onclose = () => {
      if (this.socket === socket) {
        this.scheduleRetry("Deriv WebSocket closed before the feed was ready.");
      }
    };
    this.timers.connectTimeout = setTimeout(() => {
      if (this.socket === socket && socket.readyState !== 1) {
        this.scheduleRetry(
          "Timed out opening Deriv WebSocket. Check network access to Deriv WebSocket endpoints and the app ID.",
        );
      }
    }, this.o.connectTimeoutMs ?? 15000);
  }

  private markData() {
    this.lastDataAt = Date.now();
  }

  private fail(message: string) {
    this.detach();
    this.scheduleRetry(message);
  }

  private scheduleRetry(message: string) {
    if (this.stopped || this.timers.retry) return;
    this.detach();
    clearInterval(this.timers.ping);
    const delay = backoffDelay(this.attempt++);
    this.info("ERROR", `${message} Retrying in ${Math.round(delay / 1000)}s.`);
    this.timers.retry = setTimeout(() => {
      this.timers.retry = undefined;
      this.connect();
    }, delay);
  }

  /** Pings keep an idle-but-healthy socket alive. No message at all for `staleMs` means the link is dead even if the browser has not noticed. */
  private check() {
    if (this.stopped || this.timers.retry || !this.socket) return;
    if (Date.now() - this.lastMessageAt > (this.o.staleMs ?? 60000)) {
      this.scheduleRetry("Deriv feed went silent; reconnecting.");
    }
  }
}

/** One-shot history download (up to 5000 candles) for backtesting. */
export function fetchCandles(
  symbol: string,
  granularity: number,
  count: number,
  appId = defaultAppId(),
  timeoutMs = 20000,
): Promise<Candle[]> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl(appId));
    const done = (fn: () => void) => {
      clearTimeout(timer);
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try {
        socket.close();
      } catch {
        /* noop */
      }
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error("Timed out loading history."))), timeoutMs);
    socket.onopen = () => {
      try {
        socket.send(
          JSON.stringify({
            ticks_history: symbol,
            adjust_start_time: 1,
            count: Math.min(5000, count),
            end: "latest",
            style: "candles",
            granularity,
          }),
        );
      } catch {
        done(() => reject(new Error("Could not request Deriv candle history.")));
      }
    };
    socket.onerror = () =>
      done(() =>
        reject(
          new Error(
            "Could not reach Deriv. Check network access to wss://ws.derivws.com and wss://ws.binaryws.com, then verify the configured app ID.",
          ),
        ),
      );
    socket.onclose = () =>
      done(() => reject(new Error("Deriv closed the connection before returning candle history.")));
    socket.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.error) {
        return done(() =>
          reject(new Error((msg.error as { message?: string }).message ?? "Deriv returned an error.")),
        );
      }
      if (msg.msg_type === "candles") {
        const c = parseHistory(msg);
        done(() =>
          c.length ? resolve(c) : reject(new Error("No valid candle history returned for this market/timeframe.")),
        );
      }
    };
  });
}

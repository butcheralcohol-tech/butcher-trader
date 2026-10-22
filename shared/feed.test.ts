import test from "node:test";
import assert from "node:assert/strict";
import { DerivFeed, type FeedInfo } from "../src/lib/feed.js";
import type { Candle } from "./types.js";

class FakeSocket {
  static all: FakeSocket[] = [];
  sent: string[] = []; readyState = 1;
  onopen: ((e: Event) => void) | null = null; onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null; onclose: ((e: CloseEvent) => void) | null = null;
  constructor(public url: string) { FakeSocket.all.push(this); }
  send(d: string) { this.sent.push(d); } close() { this.readyState = 3; }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
}
const hist = (n: number) => ({ msg_type: "candles", candles: Array.from({ length: n }, (_, i) => ({ epoch: 60 * (i + 1), open: 1, high: 2, low: 1, close: 1.5 })) });

function make() {
  FakeSocket.all = [];
  const infos: FeedInfo[] = [], seen: Candle[][] = [];
  const feed = new DerivFeed({ symbol: "R_100", granularity: 60, appId: "1", onCandles: c => seen.push(c), onInfo: i => infos.push(i), wsFactory: u => new FakeSocket(u) as never });
  return { feed, infos, seen };
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

test("requests candle history with a subscription, then goes LIVE and merges OHLC updates", () => {
  const { feed, infos, seen } = make();
  feed.start();
  const s = FakeSocket.all[0];
  s.onopen?.({} as Event);
  const req = JSON.parse(s.sent[0]);
  assert.equal(req.ticks_history, "R_100"); assert.equal(req.style, "candles"); assert.equal(req.subscribe, 1); assert.equal(req.granularity, 60);
  s.emit(hist(3));
  assert.equal(infos.at(-1)!.status, "LIVE");
  s.emit({ msg_type: "ohlc", ohlc: { open_time: 180, open: 1, high: 3, low: 1, close: 2.5 } });
  assert.equal(seen.at(-1)!.length, 3); assert.equal(seen.at(-1)!.at(-1)!.close, 2.5);
  s.emit({ msg_type: "ohlc", ohlc: { open_time: 240, open: 2.5, high: 3, low: 2, close: 2.8 } });
  assert.equal(seen.at(-1)!.length, 4);
  feed.stop();
});

test("a closed socket triggers a retry that opens a NEW connection, and stop() prevents further retries", async () => {
  const { feed, infos } = make();
  feed.start();
  FakeSocket.all[0].onclose?.({} as CloseEvent);
  assert.equal(infos.at(-1)!.status, "ERROR");
  await wait(1100);
  assert.equal(FakeSocket.all.length, 2);
  feed.stop();
  FakeSocket.all[1].onclose?.({} as CloseEvent);
  await wait(50);
  assert.equal(FakeSocket.all.length, 2);
  assert.equal(infos.at(-1)!.status, "STOPPED");
});

test("API errors and empty history are surfaced as ERROR, not as a silent LIVE", () => {
  const { feed, infos } = make();
  feed.start();
  FakeSocket.all[0].onopen?.({} as Event);
  FakeSocket.all[0].emit({ error: { message: "Market is presently closed." } });
  assert.equal(infos.at(-1)!.status, "ERROR");
  assert.match(infos.at(-1)!.message, /closed/);
  feed.stop();
});

test("late messages from a replaced socket are ignored", () => {
  const { feed, seen } = make();
  feed.start();
  const old = FakeSocket.all[0];
  old.emit(hist(2));
  const before = seen.length;
  feed.stop(); feed.start();
  old.emit(hist(5));
  assert.equal(seen.length, before);
  feed.stop();
});

test("after a failure the feed switches to the next endpoint, and the legacy socket gets an app_id", async () => {
  FakeSocket.all = [];
  const feed = new DerivFeed({ symbol: "R_100", granularity: 60, appId: "42", endpoints: ["wss://new.example/public", "wss://ws.derivws.com/websockets/v3"], onCandles: () => {}, onInfo: () => {}, wsFactory: u => new FakeSocket(u) as never });
  feed.start();
  assert.equal(FakeSocket.all[0].url, "wss://new.example/public");
  FakeSocket.all[0].onclose?.({} as CloseEvent);
  await wait(1100);
  assert.equal(FakeSocket.all[1].url, "wss://ws.derivws.com/websockets/v3?app_id=42");
  feed.stop();
});

test("wsUrl only adds app_id to the legacy endpoint", async () => {
  const { wsUrl, DERIV_WS_PUBLIC, DERIV_WS_LEGACY } = await import("../src/lib/feed.js");
  assert.equal(wsUrl(DERIV_WS_PUBLIC, "1"), DERIV_WS_PUBLIC);
  assert.equal(wsUrl(DERIV_WS_LEGACY, "1"), `${DERIV_WS_LEGACY}?app_id=1`);
});

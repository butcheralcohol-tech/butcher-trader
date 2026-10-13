import test from "node:test";
import assert from "node:assert/strict";
import { DerivFeed, type FeedInfo } from "../src/lib/feed.js";
import type { Candle } from "./types.js";

class FakeSocket {
  static all: FakeSocket[] = [];
  sent: string[] = []; readyState = 0;
  onopen: ((e: Event) => void) | null = null; onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null; onclose: ((e: CloseEvent) => void) | null = null;
  constructor(public url: string) { FakeSocket.all.push(this); }
  open() { this.readyState = 1; this.onopen?.({} as Event); }
  send(d: string) { this.sent.push(d); } close() { this.readyState = 3; }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
}
const hist = (n: number) => ({ msg_type: "candles", candles: Array.from({ length: n }, (_, i) => ({ epoch: 60 * (i + 1), open: 1, high: 2, low: 1, close: 1.5 })) });

function make(overrides: Partial<ConstructorParameters<typeof DerivFeed>[0]> = {}) {
  FakeSocket.all = [];
  const infos: FeedInfo[] = [], seen: Candle[][] = [];
  const feed = new DerivFeed({ symbol: "R_100", granularity: 60, appId: "1", connectTimeoutMs: 30, responseTimeoutMs: 30, onCandles: c => seen.push(c), onInfo: i => infos.push(i), wsFactory: u => new FakeSocket(u) as never, ...overrides });
  return { feed, infos, seen };
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

test("requests candle history with a subscription, then goes LIVE and merges OHLC updates", () => {
  const { feed, infos, seen } = make();
  feed.start();
  const s = FakeSocket.all[0];
  s.open();
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

test("socket that never opens gets a prompt diagnostic and retries", async () => {
  const { feed, infos } = make({ connectTimeoutMs: 10 });
  feed.start();
  await wait(25);
  assert.equal(infos.at(-1)!.status, "ERROR");
  assert.match(infos.at(-1)!.message, /Timed out opening Deriv WebSocket/);
  feed.stop();
});

test("open socket with no candle response does not stay connecting indefinitely", async () => {
  const { feed, infos } = make({ responseTimeoutMs: 10 });
  feed.start();
  FakeSocket.all[0].open();
  await wait(25);
  assert.equal(infos.at(-1)!.status, "ERROR");
  assert.match(infos.at(-1)!.message, /candle history did not arrive/);
  feed.stop();
});

test("API errors are surfaced and do not mark the feed LIVE", () => {
  const { feed, infos } = make();
  feed.start();
  FakeSocket.all[0].open();
  FakeSocket.all[0].emit({ error: { code: "InvalidSymbol", message: "Unknown symbol" } });
  assert.equal(infos.at(-1)!.status, "ERROR");
  assert.match(infos.at(-1)!.message, /InvalidSymbol.*Unknown symbol/);
  feed.stop();
});

test("OHLC arriving before history does not falsely mark feed LIVE", () => {
  const { feed, infos } = make();
  feed.start();
  FakeSocket.all[0].open();
  FakeSocket.all[0].emit({ msg_type: "ohlc", ohlc: { open_time: 60, open: 1, high: 2, low: 1, close: 1.5 } });
  assert.notEqual(infos.at(-1)!.status, "LIVE");
  feed.stop();
});

test("a closed socket triggers a retry that opens a NEW connection, and stop() prevents further retries", async () => {
  const { feed, infos } = make({ connectTimeoutMs: 5000, responseTimeoutMs: 5000 });
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

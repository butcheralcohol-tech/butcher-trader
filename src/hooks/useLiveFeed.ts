import { useEffect, useState } from "react";
import type { Candle } from "../../shared/types.js";
import { DerivFeed, type FeedInfo } from "../lib/feed";

export const idleInfo: FeedInfo = {
  status: "CONNECTING",
  message: "Connecting to Deriv…",
  attempt: 0,
  lastDataAt: null,
};

/** Live Deriv candles for one market/timeframe. Reconnects automatically; cleans up on change/unmount. */
export function useLiveFeed(symbol: string, granularity: number, count = 300) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [info, setInfo] = useState<FeedInfo>(idleInfo);

  useEffect(() => {
    setCandles([]);
    setInfo(idleInfo);
    const feed = new DerivFeed({
      symbol,
      granularity,
      count,
      onCandles: setCandles,
      onInfo: setInfo,
    });
    feed.start();
    return () => feed.stop();
  }, [symbol, granularity, count]);

  return { candles, info };
}

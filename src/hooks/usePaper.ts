import { useCallback, useEffect, useState } from "react";
import type { Candle, Side } from "../../shared/types.js";
import {
  adjustPaperBalance,
  advancePaper,
  newSession,
  parseSession,
  queueManualPaperSignal,
  type PaperMeta,
  type PaperSession,
} from "../../shared/paper.js";
import { DerivFeed, type FeedInfo } from "../lib/feed";
import { idleInfo } from "./useLiveFeed";

const KEY = "butcher.paper.v1";
const load = (): PaperSession | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseSession(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

/** Demo-only paper trading. Runs while this page is open; state is kept in this browser's localStorage. Never contacts a broker account. */
export function usePaper() {
  const [session, setSession] = useState<PaperSession | null>(load);
  const [info, setInfo] = useState<FeedInfo>(idleInfo);
  const [candles, setCandles] = useState<Candle[]>([]);

  useEffect(() => {
    try {
      if (session) localStorage.setItem(KEY, JSON.stringify(session));
      else localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable */
    }
  }, [session]);

  const symbol = session?.meta.symbol;
  const granularity = session?.meta.granularity;
  useEffect(() => {
    if (!symbol || !granularity) return;
    setInfo(idleInfo);
    const feed = new DerivFeed({
      symbol,
      granularity,
      count: 500,
      onCandles: setCandles,
      onInfo: setInfo,
    });
    feed.start();
    return () => {
      feed.stop();
      setCandles([]);
    };
  }, [symbol, granularity]);

  // The last candle is still forming, so only earlier candles are treated as closed.
  useEffect(() => {
    if (candles.length < 2) return;
    const closed = candles.slice(0, -1);
    setSession((prev) => (prev ? advancePaper(prev, closed) : prev));
  }, [candles]);

  const start = useCallback(
    (meta: PaperMeta, balance: number) => setSession(newSession(meta, balance)),
    [],
  );
  const manualTrade = useCallback(
    (side: Side, stopPercent: number, rewardRisk: number) => {
      const price = candles[candles.length - 1]?.close;
      if (!Number.isFinite(price) || !price || price <= 0) return;
      setSession((prev) => {
        if (!prev) return prev;
        const next = queueManualPaperSignal(prev, side, price, stopPercent, rewardRisk);
        return next ?? prev;
      });
    },
    [candles],
  );
  const adjustBalance = useCallback(
    (newBalance: number) =>
      setSession((prev) => {
        if (!prev) return prev;
        const next = adjustPaperBalance(prev, newBalance);
        return next ?? prev;
      }),
    [],
  );
  const reset = useCallback(() => setSession(null), []);
  return { session, info, candles, start, reset, manualTrade, adjustBalance };
}

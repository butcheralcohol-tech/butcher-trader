export function GET(): Response {
  return Response.json({ mode: "DEMO_ONLY", liveTradingEnabled: false, note: "Market-data feed is public/read-only. Order placement is not implemented." });
}

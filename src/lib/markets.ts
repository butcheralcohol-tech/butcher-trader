export const MARKETS = [
  { symbol: "R_100", name: "Volatility 100 Index", group: "SYNTHETIC" },
  { symbol: "R_75", name: "Volatility 75 Index", group: "SYNTHETIC" },
  { symbol: "R_50", name: "Volatility 50 Index", group: "SYNTHETIC" },
  { symbol: "frxEURUSD", name: "EUR / USD", group: "FOREX" },
  { symbol: "frxGBPUSD", name: "GBP / USD", group: "FOREX" },
] as const;
export type MarketSymbol = (typeof MARKETS)[number]["symbol"];

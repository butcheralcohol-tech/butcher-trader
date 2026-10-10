export type Candle = { time: number; open: number; high: number; low: number; close: number };
export type Side = "LONG" | "SHORT";
export type Signal = { side: Side; stop: number; target: number; reason: string };

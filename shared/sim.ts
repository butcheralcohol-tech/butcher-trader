import { evaluateRisk } from "./risk.js";
import type { Candle, Side, Signal } from "./types.js";

/** One candle-by-candle execution model shared by the backtester and the paper trader, so both behave identically.
 * Signals are read at a candle CLOSE and filled at the NEXT candle's OPEN. If stop and target are both touched inside one candle, the stop is assumed first. */
export type SimConfig = {
  riskPercent: number; dailyLossLimitPercent: number;
  /** Absolute limits for the paper session and trading day. */
  dailyLossLimitAmount?: number; sessionLossLimitAmount?: number; dailyProfitTargetAmount?: number; tradeProfitTargetAmount?: number; sessionProfitTargetAmount?: number;
  feeBps: number; slippageBps: number; maxHoldBars: number; maxLeverage: number; allowShort: boolean;
};
export const DEFAULT_SIM: SimConfig = { riskPercent: 0.5, dailyLossLimitPercent: 2, feeBps: 2, slippageBps: 1, maxHoldBars: 50, maxLeverage: 5, allowShort: true };

export type ExitReason = "stop" | "target" | "trade-profit-target" | "session-profit-target" | "timeout" | "end";
export type Position = { id: number; side: Side; entry: number; stop: number; target: number; units: number; risk: number; entryFee: number; openedAt: number; bars: number; reason: string };
export type Trade = { id: number; side: Side; entryTime: number; exitTime: number; entry: number; exit: number; stop: number; target: number; units: number; pnl: number; fees: number; r: number; exitReason: ExitReason; bars: number; signal: string };
export type AuditType = "INFO" | "SIGNAL" | "GATE_BLOCKED" | "FILLED" | "EXIT" | "SKIPPED";
export type AuditEvent = { time: number; type: AuditType; message: string };
export type PendingSignal = Signal & { signalTime: number };
export type SimState = {
  startBalance: number; balance: number; dayKey: string; dayPnl: number;
  pending: PendingSignal | null; position: Position | null;
  trades: Trade[]; events: AuditEvent[]; logEvents: boolean;
  blockedSignals: number; skippedSignals: number; feesPaid: number; nextId: number; lastCandleTime: number;
};

export const createState = (balance: number, logEvents = true): SimState => ({
  startBalance: balance, balance, dayKey: "", dayPnl: 0, pending: null, position: null, trades: [], events: [], logEvents,
  blockedSignals: 0, skippedSignals: 0, feesPaid: 0, nextId: 1, lastCandleTime: 0,
});

const log = (s: SimState, time: number, type: AuditType, message: string) => { if (s.logEvents) s.events.push({ time, type, message }); };
const gate = (s: SimState, cfg: SimConfig) => evaluateRisk({
  balance: s.balance, riskPercent: cfg.riskPercent, dailyLossLimitPercent: cfg.dailyLossLimitPercent,
  dailyLossLimitAmount: cfg.dailyLossLimitAmount, sessionLossLimitAmount: cfg.sessionLossLimitAmount,
  sessionPnl: s.balance - s.startBalance, dailyProfitTargetAmount: cfg.dailyProfitTargetAmount, sessionProfitTargetAmount: cfg.sessionProfitTargetAmount,
  dailyPnl: s.dayPnl, openPositions: s.position ? 1 : 0, maxOpenPositions: 1, liveEnabled: false,
});
const px = (n: number) => n.toFixed(Math.abs(n) >= 100 ? 2 : 4);

function fillPending(s: SimState, c: Candle, cfg: SimConfig): boolean {
  const sig = s.pending!; s.pending = null;
  const decision = gate(s, cfg);
  if (!decision.allowed) { s.blockedSignals++; log(s, c.time, "GATE_BLOCKED", `Fill blocked: ${decision.reasons.join(" ")}`); return false; }
  const slip = cfg.slippageBps / 10000, long = sig.side === "LONG";
  const entry = long ? c.open * (1 + slip) : c.open * (1 - slip);
  const dist = long ? entry - sig.stop : sig.stop - entry;
  if (!(dist > 0) || !(long ? sig.target > entry : sig.target < entry)) {
    s.skippedSignals++; log(s, c.time, "SKIPPED", `Price gapped through stop/target at ${px(entry)}; no position opened.`); return false;
  }
  const units = Math.min(decision.maxRiskAmount / dist, (s.balance * cfg.maxLeverage) / entry);
  if (!(units > 0)) { s.skippedSignals++; log(s, c.time, "SKIPPED", "Position size rounds to zero."); return false; }
  s.position = { id: s.nextId++, side: sig.side, entry, stop: sig.stop, target: sig.target, units, risk: units * dist, entryFee: (entry * units * cfg.feeBps) / 10000, openedAt: c.time, bars: 0, reason: sig.reason };
  log(s, c.time, "FILLED", `PAPER ${sig.side} ${units.toFixed(4)} @ ${px(entry)} · stop ${px(sig.stop)} · target ${px(sig.target)} · risk $${s.position.risk.toFixed(2)}`);
  return true;
}

function close(s: SimState, time: number, exit: number, reason: ExitReason, cfg: SimConfig) {
  const p = s.position!, dir = p.side === "LONG" ? 1 : -1;
  const exitFee = (exit * p.units * cfg.feeBps) / 10000, fees = p.entryFee + exitFee;
  const pnl = (exit - p.entry) * p.units * dir - fees;
  s.balance += pnl; s.dayPnl += pnl; s.feesPaid += fees;
  s.trades.push({ id: p.id, side: p.side, entryTime: p.openedAt, exitTime: time, entry: p.entry, exit, stop: p.stop, target: p.target, units: p.units, pnl, fees, r: pnl / p.risk, exitReason: reason, bars: p.bars, signal: p.reason });
  log(s, time, "EXIT", `${p.side} closed by ${reason} @ ${px(exit)} · P&L ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} (${(pnl / p.risk).toFixed(2)}R) · balance ${s.balance.toFixed(2)}`);
  s.position = null;
}

function profitTargetPrice(p: Position, targetNetPnl: number, feeBps: number): number {
  const rate = feeBps / 10000;
  if (p.side === "LONG") return (p.entry * p.units + p.entryFee + targetNetPnl) / (p.units * (1 - rate));
  return (p.entry * p.units - p.entryFee - targetNetPnl) / (p.units * (1 + rate));
}

function manage(s: SimState, c: Candle, justFilled: boolean, cfg: SimConfig) {
  const p = s.position!, slip = cfg.slippageBps / 10000;
  p.bars++;
  if (p.side === "LONG") {
    if (c.low <= p.stop || (!justFilled && c.open <= p.stop)) return close(s, c.time, (!justFilled && c.open <= p.stop ? c.open : p.stop) * (1 - slip), "stop", cfg);
    if (c.high >= p.target) return close(s, c.time, p.target, "target", cfg);
  } else {
    if (c.high >= p.stop || (!justFilled && c.open >= p.stop)) return close(s, c.time, (!justFilled && c.open >= p.stop ? c.open : p.stop) * (1 + slip), "stop", cfg);
    if (c.low <= p.target) return close(s, c.time, p.target, "target", cfg);
  }
  const direction = p.side === "LONG" ? 1 : -1;
  const favorableExtreme = p.side === "LONG" ? c.high : c.low;
  const tradeTarget = cfg.tradeProfitTargetAmount;
  if (tradeTarget !== undefined && Number.isFinite(tradeTarget) && tradeTarget > 0) {
    const trigger = profitTargetPrice(p, tradeTarget, cfg.feeBps);
    if ((p.side === "LONG" && favorableExtreme >= trigger) || (p.side === "SHORT" && favorableExtreme <= trigger)) {
      close(s, c.time, trigger, "trade-profit-target", cfg);
      return;
    }
  }
  const sessionTarget = cfg.sessionProfitTargetAmount;
  if (sessionTarget !== undefined && Number.isFinite(sessionTarget) && sessionTarget > 0) {
    const realizedSessionPnl = s.balance - s.startBalance;
    const remaining = sessionTarget - realizedSessionPnl;
    if (remaining <= 0) { close(s, c.time, c.close * (1 - direction * slip), "session-profit-target", cfg); return; }
    const trigger = profitTargetPrice(p, remaining, cfg.feeBps);
    if ((p.side === "LONG" && favorableExtreme >= trigger) || (p.side === "SHORT" && favorableExtreme <= trigger)) {
      close(s, c.time, trigger, "session-profit-target", cfg);
      return;
    }
  }
  if (p.bars >= cfg.maxHoldBars) close(s, c.time, c.close * (p.side === "LONG" ? 1 - slip : 1 + slip), "timeout", cfg);
}

/** Advance the simulation by one CLOSED candle. Pass signalFn = null to manage exits only (no new entries). Mutates s. */
export function stepCandle(s: SimState, c: Candle, signalFn: (() => Signal | null) | null, cfg: SimConfig): void {
  const day = new Date(c.time * 1000).toISOString().slice(0, 10);
  if (day !== s.dayKey) { s.dayKey = day; s.dayPnl = 0; }
  const justFilled = s.pending && !s.position ? fillPending(s, c, cfg) : false;
  if (!signalFn) s.pending = null;
  if (s.position) manage(s, c, justFilled, cfg);
  if (!s.position && !s.pending && signalFn) {
    const sig = signalFn();
    if (sig) {
      if (sig.side === "SHORT" && !cfg.allowShort) { s.skippedSignals++; log(s, c.time, "SKIPPED", "Short signal ignored (shorting disabled)."); }
      else {
        const decision = gate(s, cfg);
        if (!decision.allowed) { s.blockedSignals++; log(s, c.time, "GATE_BLOCKED", `${sig.side} signal blocked: ${decision.reasons.join(" ")}`); }
        else { s.pending = { ...sig, signalTime: c.time }; log(s, c.time, "SIGNAL", `${sig.side} signal: ${sig.reason}. Gate passed (max risk $${decision.maxRiskAmount.toFixed(2)}). Fill at next open.`); }
      }
    }
  }
  s.lastCandleTime = c.time;
}

/** Close any open position at the last candle's close (used at the end of a backtest). */
export function finalize(s: SimState, last: Candle, cfg: SimConfig): void {
  s.pending = null;
  if (s.position) close(s, last.time, last.close * (s.position.side === "LONG" ? 1 - cfg.slippageBps / 10000 : 1 + cfg.slippageBps / 10000), "end", cfg);
}
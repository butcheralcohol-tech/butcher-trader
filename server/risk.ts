export type RiskConfig = { balance: number; riskPercent: number; dailyLossLimitPercent: number; dailyPnl: number; openPositions: number; maxOpenPositions: number; liveEnabled: boolean };
export type RiskDecision = { allowed: boolean; reasons: string[]; maxRiskAmount: number };

/** Fail-closed pre-trade gate. This does not place orders. */
export function evaluateRisk(config: RiskConfig): RiskDecision {
  const reasons: string[] = [];
  if (!Number.isFinite(config.balance) || config.balance <= 0) reasons.push("Balance must be positive.");
  if (config.riskPercent <= 0 || config.riskPercent > 1) reasons.push("Per-trade risk must be between 0 and 1%.");
  if (config.dailyLossLimitPercent <= 0 || config.dailyLossLimitPercent > 3) reasons.push("Daily loss limit must be between 0 and 3%.");
  if (config.dailyPnl <= -(config.balance * config.dailyLossLimitPercent / 100)) reasons.push("Daily loss limit reached; trading is locked.");
  if (config.openPositions >= config.maxOpenPositions) reasons.push("Maximum open positions reached.");
  if (config.liveEnabled) reasons.push("Live execution is not implemented in this milestone; live orders are blocked.");
  return { allowed: reasons.length === 0, reasons, maxRiskAmount: Math.max(0, config.balance * config.riskPercent / 100) };
}

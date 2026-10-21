export type RiskConfig = {
  balance: number;
  riskPercent: number;
  dailyLossLimitPercent: number;
  /** Optional hard currency-denominated cap; use broker-confirmed daily P&L in production. */
  dailyLossLimitAmount?: number;
  dailyPnl: number;
  openPositions: number;
  maxOpenPositions: number;
  liveEnabled: boolean;
};
export type RiskDecision = { allowed: boolean; reasons: string[]; maxRiskAmount: number };

/** Fail-closed pre-trade gate. This does not place orders or guarantee loss prevention. */
export function evaluateRisk(config: RiskConfig): RiskDecision {
  const reasons: string[] = [];
  const finite = [config.balance, config.riskPercent, config.dailyLossLimitPercent, config.dailyPnl, config.openPositions, config.maxOpenPositions].every(Number.isFinite);
  if (!finite) reasons.push("All numeric risk settings must be finite numbers.");
  if (!Number.isFinite(config.balance) || config.balance <= 0) reasons.push("Balance must be positive.");
  if (!Number.isFinite(config.riskPercent) || config.riskPercent <= 0 || config.riskPercent > 1) reasons.push("Per-trade risk must be greater than 0 and at most 1%.");
  if (!Number.isFinite(config.dailyLossLimitPercent) || config.dailyLossLimitPercent <= 0 || config.dailyLossLimitPercent > 3) reasons.push("Daily loss limit must be greater than 0 and at most 3%.");
  if (config.dailyLossLimitAmount !== undefined &&
      (!Number.isFinite(config.dailyLossLimitAmount) || config.dailyLossLimitAmount <= 0)) {
    reasons.push("Absolute daily loss limit must be a positive finite amount.");
  }
  const percentLossLimit = config.balance * config.dailyLossLimitPercent / 100;
  const absoluteLossLimit = config.dailyLossLimitAmount;
  if (!Number.isFinite(config.dailyPnl) || config.dailyPnl <= -percentLossLimit ||
      (absoluteLossLimit !== undefined && config.dailyPnl <= -absoluteLossLimit)) {
    reasons.push("Daily loss limit reached; trading is locked until the next trading day.");
  }
  if (!Number.isInteger(config.openPositions) || config.openPositions < 0) reasons.push("Open position count must be a non-negative integer.");
  if (!Number.isInteger(config.maxOpenPositions) || config.maxOpenPositions < 1 || config.maxOpenPositions > 1) reasons.push("This milestone allows at most one open position.");
  if (config.openPositions >= config.maxOpenPositions) reasons.push("Maximum open positions reached.");
  if (config.liveEnabled) reasons.push("Live execution is not implemented in this milestone; live orders are blocked.");
  const rawMaxRisk = config.balance * config.riskPercent / 100;
  const maxRiskAmount = Number.isFinite(rawMaxRisk) && config.balance > 0 && config.riskPercent > 0
    ? Math.round(rawMaxRisk * 100) / 100
    : 0;
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], maxRiskAmount: reasons.length === 0 ? maxRiskAmount : 0 };
}

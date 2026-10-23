export type WorkerRiskState = {
  accountId: string;
  currency: string;
  startingBalance: number;
  realizedNetPnl: number;
  sessionNetPnl: number;
  marketNetPnl: Record<string, number>;
  openContractIds: string[];
  halted: boolean;
  haltReason?: string;
};

export type WorkerRiskConfig = {
  maxStakePercent: 1;
  dailyLossLimitUsd: number;
  sessionLossLimitUsd: number;
  marketLossLimitUsd: Record<string, number>;
  dailyProfitTargetUsd: number;
  minimumStake: number;
  maximumOpenContracts: 1;
};

export type WorkerRiskDecision = { allowed: boolean; reasons: string[]; maxStake: number };

/** Pure preflight used by the persistent worker. Unknown/non-finite state always blocks. */
export function checkWorkerRisk(input: {
  state: WorkerRiskState;
  config: WorkerRiskConfig;
  market: string;
  stake: number;
  brokerBalance: number;
  brokerOpenContractIds: string[];
}): WorkerRiskDecision {
  const { state, config, market, stake, brokerBalance, brokerOpenContractIds } = input;
  const reasons: string[] = [];
  const values = [state.startingBalance, state.realizedNetPnl, state.sessionNetPnl, brokerBalance, stake,
    config.dailyLossLimitUsd, config.sessionLossLimitUsd, config.dailyProfitTargetUsd,
    config.minimumStake, config.maxStakePercent, config.maximumOpenContracts,
    state.marketNetPnl[market] ?? 0, config.marketLossLimitUsd[market]];
  if (!values.every(Number.isFinite)) reasons.push("Risk state or market limit is missing/non-finite.");
  if (!/^VRTC\\d+$/.test(state.accountId)) reasons.push("Only a verified Deriv virtual account is allowed.");
  if (!/^[A-Z]{3,5}$/.test(state.currency)) reasons.push("Account currency is invalid.");
  if (state.halted) reasons.push("Worker is halted; operator reset and reconciliation are required.");
  if (brokerBalance <= 0) reasons.push("Broker balance is not positive.");
  if (state.realizedNetPnl <= -config.dailyLossLimitUsd) reasons.push("Daily hard stop reached.");
  if (state.sessionNetPnl <= -config.sessionLossLimitUsd) reasons.push("Session hard stop reached.");
  if ((state.marketNetPnl[market] ?? 0) <= -(config.marketLossLimitUsd[market] ?? Number.NaN)) reasons.push("Market hard stop reached or market limit missing.");
  if (state.realizedNetPnl >= config.dailyProfitTargetUsd) reasons.push("Daily target reached; entries paused.");
  if (brokerOpenContractIds.length > 0 || state.openContractIds.length > 0) reasons.push("An open contract exists; only one-order-at-a-time is permitted.");
  if (brokerOpenContractIds.length >= config.maximumOpenContracts) reasons.push("Broker open-contract limit reached.");
  const maxStake = Math.floor(Math.min(brokerBalance * config.maxStakePercent / 100, brokerBalance) * 100) / 100;
  if (stake < config.minimumStake) reasons.push("Stake is below configured minimum.");
  if (stake <= 0 || stake > maxStake) reasons.push("Stake exceeds the 1% broker-balance risk ceiling.");
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], maxStake };
}

/** FX is closed on weekends; synthetics are not. Caller must pass a known market class. */
export function isMarketSessionOpen(marketClass: "synthetic" | "forex", now: Date): boolean {
  if (Number.isNaN(now.getTime())) return false;
  if (marketClass === "synthetic") return true;
  const day = now.getUTCDay();
  if (day === 6 || day === 0) return false;
  // Conservative FX session: weekdays only; no order is allowed around the weekend boundary.
  if (day === 5 && now.getUTCHours() >= 21) return false;
  if (day === 0 && now.getUTCHours() < 22) return false;
  return true;
}

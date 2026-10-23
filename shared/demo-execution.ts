export type DemoAccount = {
  loginid: string;
  is_virtual: 1 | 0;
  currency: string;
  balance: number;
};

export type BrokerOpenContract = {
  contract_id: number;
  buy_price: number;
  payout?: number;
  profit?: number;
  is_sold?: 0 | 1;
  status?: string;
};

export type ExecutionRiskInput = {
  account: DemoAccount;
  stake: number;
  dailyNetPnl: number;
  marketNetPnl?: number;
  sessionNetPnl?: number;
  dailyLossLimitUsd: number;
  dailyProfitTargetUsd: number;
  riskPercent: number;
  openContracts: number;
  maxOpenContracts: number;
  marketLossLimitUsd?: number;
  sessionLossLimitUsd?: number;
};

export type ExecutionRiskDecision = { allowed: boolean; reasons: string[]; maxStake: number };

/**
 * Fail closed unless the server independently verifies a virtual account.
 * Loss limits are adjustable inputs, but remain bounded by the global safety ceiling.
 */
export function evaluateDemoExecutionRisk(input: ExecutionRiskInput): ExecutionRiskDecision {
  const reasons: string[] = [];
  const marketLossLimitUsd = input.marketLossLimitUsd ?? input.dailyLossLimitUsd;
  const sessionLossLimitUsd = input.sessionLossLimitUsd ?? input.dailyLossLimitUsd;
  const marketNetPnl = input.marketNetPnl ?? input.dailyNetPnl;
  const sessionNetPnl = input.sessionNetPnl ?? input.dailyNetPnl;
  const numeric = [input.account.balance, input.stake, input.dailyNetPnl, marketNetPnl, sessionNetPnl, input.dailyLossLimitUsd,
    input.dailyProfitTargetUsd, input.riskPercent, input.openContracts, input.maxOpenContracts,
    marketLossLimitUsd, sessionLossLimitUsd];
  if (!numeric.every(Number.isFinite)) reasons.push("Risk inputs must be finite.");
  if (input.account.is_virtual !== 1 || !/^VRTC\d+$/.test(input.account.loginid)) {
    reasons.push("Only a broker-verified Deriv virtual account is permitted.");
  }
  if (!input.account.currency || !/^[A-Z]{3,5}$/.test(input.account.currency)) reasons.push("Broker account currency is invalid.");
  if (input.account.balance <= 0) reasons.push("Broker-reported balance must be positive.");
  if (input.riskPercent !== 1) reasons.push("This milestone enforces a maximum planned risk of 1% per trade.");
  const limits = [
    ["Daily", input.dailyLossLimitUsd],
    ["Per-market", marketLossLimitUsd],
    ["Per-session", sessionLossLimitUsd],
  ] as const;
  for (const [label, limit] of limits) {
    if (limit <= 0 || limit > 20) reasons.push(`${label} loss cap must be positive and no greater than $20.`);
    const pnl = label === "Daily" ? input.dailyNetPnl : label === "Per-market" ? marketNetPnl : sessionNetPnl;
    if (pnl <= -limit) reasons.push(`Broker-confirmed ${label.toLowerCase()} loss cap reached; entries are locked.`);
  }
  if (input.dailyProfitTargetUsd < 24 || input.dailyProfitTargetUsd > 10000) {
    reasons.push("Daily profit target must be between $24 and $10,000; it is aspirational, not guaranteed.");
  }
  if (input.dailyNetPnl >= input.dailyProfitTargetUsd) reasons.push("Daily profit target reached; new entries are paused.");
  if (input.openContracts !== 0) reasons.push("An open contract already exists; this milestone allows one at a time.");
  if (input.maxOpenContracts !== 1) reasons.push("Maximum concurrent open contracts is fixed at one.");
  const maxStake = Math.floor(Math.min(input.account.balance * 0.01, input.account.balance) * 100) / 100;
  if (!Number.isFinite(input.stake) || input.stake <= 0 || input.stake > maxStake) {
    reasons.push(`Stake exceeds the 1% cap of ${maxStake.toFixed(2)} ${input.account.currency}.`);
  }
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], maxStake };
}

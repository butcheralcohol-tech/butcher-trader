export const TRADING_POLICY = Object.freeze({
  markets: ["SYNTHETIC", "FOREX"] as const,
  mode: "DEMO_ONLY" as const, accountMode: "demo" as const,
  startingBalanceUsd: 1000, minimumStartingBalanceUsd: 2,
  dailyProfitTargetUsd: 40, minimumDailyProfitTargetUsd: 24,
  dailyLossLimitUsd: 20,
  dailyLossLimitsUsd: Object.freeze({ SYNTHETIC: 20, FOREX: 20 }),
  sessionLossLimitUsd: 20,
  riskPercent: 1, dailyLossLimitPercent: 3,
  dailyLossAction: "PAUSE_UNTIL_NEXT_DAY" as const, maxOpenPositions: 1,
  strategyMethod: "weighted" as const, liveTradingEnabled: false as const,
  demoTestingRequired: true as const, authorizationRequired: true as const,
  explicitSafetyChecksRequired: true as const,
});

export type TradingMarket = typeof TRADING_POLICY.markets[number];

/**
 * Readiness evidence required before a separately reviewed live execution
 * implementation can even be considered. This is a policy gate, not an order
 * executor. The application remains demo-only until the policy itself is
 * intentionally changed in a reviewed release.
 */
export type LiveExecutionReadiness = {
  oauthImplemented: boolean;
  brokerAccountVerified: boolean;
  accountType: "real" | "demo" | "wallet" | "unknown";
  accountId: string;
  demoOrdersVerified: boolean;
  settlementReconciliationVerified: boolean;
  durableRiskStoreVerified: boolean;
  atomicLossGuardVerified: boolean;
  emergencyStopVerified: boolean;
  marketHoursVerified: boolean;
  singleOrderFirstRunEnabled: boolean;
  explicitApproval: boolean;
  safetyReviewPassed: boolean;
};

/** Return specific fail-closed reasons; never treat missing evidence as success. */
export function liveExecutionBlockers(checks: Partial<LiveExecutionReadiness> | null | undefined): string[] {
  if (!checks) return ["readiness evidence is missing"];
  const blockers: string[] = [];
  if (checks.oauthImplemented !== true) blockers.push("OAuth/session authentication is not verified");
  if (checks.brokerAccountVerified !== true) blockers.push("broker account identity is not verified");
  if (checks.accountType !== "real") blockers.push("account is not verified as a real CR account");
  if (typeof checks.accountId !== "string" || !/^CR\\d+$/.test(checks.accountId)) {
    blockers.push("account ID is not a verified CR trading account");
  }
  if (checks.demoOrdersVerified !== true) blockers.push("demo order lifecycle has not passed");
  if (checks.settlementReconciliationVerified !== true) blockers.push("broker settlement reconciliation is not verified");
  if (checks.durableRiskStoreVerified !== true) blockers.push("durable risk storage is not verified");
  if (checks.atomicLossGuardVerified !== true) blockers.push("atomic cumulative loss guard is not verified");
  if (checks.emergencyStopVerified !== true) blockers.push("emergency stop and socket shutdown are not verified");
  if (checks.marketHoursVerified !== true) blockers.push("market-hours checks are not verified");
  if (checks.singleOrderFirstRunEnabled !== true) blockers.push("single-order first-run restriction is not enabled");
  if (checks.explicitApproval !== true) blockers.push("explicit live-trading approval is missing");
  if (checks.safetyReviewPassed !== true) blockers.push("safety review has not passed");
  // This final invariant intentionally prevents this helper from ever enabling live orders.
  blockers.push("live execution is disabled by the release policy");
  return blockers;
}

export function canEnableLiveTrading(checks: {
  oauthImplemented: boolean;
  demoOrdersVerified: boolean;
  safetyReviewPassed: boolean;
  explicitApproval: boolean;
}): boolean {
  return checks.oauthImplemented && checks.demoOrdersVerified &&
    checks.safetyReviewPassed && checks.explicitApproval &&
    TRADING_POLICY.liveTradingEnabled;
}

/**
 * Default policy for the next BUTCHER TRADER milestone.
 * Demo-only. Real order execution remains hard-disabled until authenticated
 * broker order flow, account selection, reconciliation, and risk enforcement
 * have been integration-tested.
 */
export const TRADING_POLICY = Object.freeze({
  markets: ["SYNTHETIC", "FOREX"] as const,
  mode: "DEMO_ONLY" as const,
  accountMode: "demo" as const,
  startingBalanceUsd: 1000,
  dailyProfitTargetUsd: 40,
  dailyLossLimitUsd: 20,
  riskPercent: 1,
  dailyLossLimitPercent: 2,
  dailyLossAction: "PAUSE_UNTIL_NEXT_DAY" as const,
  maxOpenPositions: 1,
  strategyMethod: "weighted" as const,
  liveTradingEnabled: false as const,
  demoTestingRequired: true as const,
  authorizationRequired: true as const,
  explicitSafetyChecksRequired: true as const,
});

export type TradingMarket = typeof TRADING_POLICY.markets[number];

/** A hard lock: configuration alone can never turn live execution on. */
export function canEnableLiveTrading(checks: {
  oauthImplemented: boolean;
  demoOrdersVerified: boolean;
  safetyReviewPassed: boolean;
  explicitApproval: boolean;
}): boolean {
  return checks.oauthImplemented
    && checks.demoOrdersVerified
    && checks.safetyReviewPassed
    && checks.explicitApproval
    && TRADING_POLICY.liveTradingEnabled;
}

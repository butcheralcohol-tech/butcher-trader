/**
 * Default policy for the next BUTCHER TRADER milestone.
 * Live order execution remains hard-disabled until OAuth, demo order testing,
 * server-side authorization, and explicit safety review are complete.
 */
export const TRADING_POLICY = Object.freeze({
  markets: ["SYNTHETIC", "FOREX"] as const,
  mode: "LIVE_PREPARATION_DEMO_LOCKED" as const,
  riskPercent: 1,
  dailyLossLimitPercent: 3,
  dailyLossAction: "PAUSE_UNTIL_NEXT_DAY" as const,
  maxOpenPositions: 1,
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

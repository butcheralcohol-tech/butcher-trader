export const TRADING_POLICY = Object.freeze({
  markets: ["SYNTHETIC", "FOREX"] as const,
  mode: "DEMO_ONLY" as const, accountMode: "demo" as const,
  startingBalanceUsd: 1000, minimumStartingBalanceUsd: 10,
  dailyProfitTargetUsd: 40, minimumDailyProfitTargetUsd: 24,
  dailyLossLimitUsd: 20,
  dailyLossLimitsUsd: Object.freeze({ SYNTHETIC: 20, FOREX: 20 }),
  sessionLossLimitUsd: 20,
  riskPercent: 1, dailyLossLimitPercent: 2,
  dailyLossAction: "PAUSE_UNTIL_NEXT_DAY" as const, maxOpenPositions: 1,
  strategyMethod: "weighted" as const, liveTradingEnabled: false as const,
  demoTestingRequired: true as const, authorizationRequired: true as const,
  explicitSafetyChecksRequired: true as const,
});
export type TradingMarket = typeof TRADING_POLICY.markets[number];
export function canEnableLiveTrading(checks: { oauthImplemented:boolean; demoOrdersVerified:boolean; safetyReviewPassed:boolean; explicitApproval:boolean }): boolean {
 return checks.oauthImplemented && checks.demoOrdersVerified && checks.safetyReviewPassed && checks.explicitApproval && TRADING_POLICY.liveTradingEnabled;
}
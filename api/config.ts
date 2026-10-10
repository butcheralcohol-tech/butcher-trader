import { TRADING_POLICY } from "../shared/trading-config.js";

export function GET(): Response {
  return Response.json({
    mode: TRADING_POLICY.mode,
    markets: TRADING_POLICY.markets,
    riskPercent: TRADING_POLICY.riskPercent,
    dailyLossLimitPercent: TRADING_POLICY.dailyLossLimitPercent,
    dailyLossAction: TRADING_POLICY.dailyLossAction,
    maxOpenPositions: TRADING_POLICY.maxOpenPositions,
    liveTradingEnabled: false,
    demoTestingRequired: TRADING_POLICY.demoTestingRequired,
    authorizationRequired: TRADING_POLICY.authorizationRequired,
    explicitSafetyChecksRequired: TRADING_POLICY.explicitSafetyChecksRequired,
    note: "Live execution is hard-disabled. Public market data is read-only; no broker orders can be placed.",
  });
}

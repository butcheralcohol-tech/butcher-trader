import { TRADING_POLICY } from "../shared/trading-config.js";

export function GET(): Response {
  return Response.json({
    mode: TRADING_POLICY.mode,
    accountMode: TRADING_POLICY.accountMode,
    markets: TRADING_POLICY.markets,
    startingBalanceUsd: TRADING_POLICY.startingBalanceUsd,
    dailyProfitTargetUsd: TRADING_POLICY.dailyProfitTargetUsd,
    dailyLossLimitUsd: TRADING_POLICY.dailyLossLimitUsd,
    riskPercent: TRADING_POLICY.riskPercent,
    dailyLossLimitPercent: TRADING_POLICY.dailyLossLimitPercent,
    dailyLossAction: TRADING_POLICY.dailyLossAction,
    maxOpenPositions: TRADING_POLICY.maxOpenPositions,
    strategyMethod: TRADING_POLICY.strategyMethod,
    liveTradingEnabled: false,
    demoTestingRequired: TRADING_POLICY.demoTestingRequired,
    authorizationRequired: TRADING_POLICY.authorizationRequired,
    explicitSafetyChecksRequired: TRADING_POLICY.explicitSafetyChecksRequired,
    note: "Demo policy only. Real broker order placement is not implemented; daily risk checks are not yet fed by authoritative broker results.",
  });
}

import { evaluateRisk } from "../../shared/risk.js";
import { TRADING_POLICY } from "../../shared/trading-config.js";
import { parseRiskInput } from "../../shared/validate.js";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { allowed: false, reasons: ["Request body must be valid JSON."], maxRiskAmount: 0 },
      { status: 400 },
    );
  }

  const parsed = parseRiskInput(body);
  if (!parsed.ok) {
    return Response.json(
      { allowed: false, reasons: parsed.reasons, maxRiskAmount: 0 },
      { status: 400 },
    );
  }

  // Enforce fixed policy values server-side. The supplied balance and P&L are
  // still user-provided; this is a demo risk check, not broker-authoritative
  // authorization. No order endpoint currently consumes this decision.
  const decision = evaluateRisk({
    ...parsed.value,
    riskPercent: TRADING_POLICY.riskPercent,
    dailyLossLimitPercent: TRADING_POLICY.dailyLossLimitPercent,
    dailyLossLimitAmount: TRADING_POLICY.dailyLossLimitUsd,
    dailyProfitTargetAmount: TRADING_POLICY.dailyProfitTargetUsd,
    maxOpenPositions: TRADING_POLICY.maxOpenPositions,
    liveEnabled: false,
  });

  return Response.json(
    {
      ...decision,
      policy: {
        accountMode: TRADING_POLICY.accountMode,
        startingBalanceUsd: TRADING_POLICY.startingBalanceUsd,
        riskPercent: TRADING_POLICY.riskPercent,
        dailyLossLimitUsd: TRADING_POLICY.dailyLossLimitUsd,
        dailyProfitTargetUsd: TRADING_POLICY.dailyProfitTargetUsd,
        strategyMethod: TRADING_POLICY.strategyMethod,
        liveTradingEnabled: false,
      },
      note: "Demo pre-trade check only. Balance/P&L are not broker-verified, and this endpoint does not authorize or place broker orders.",
    },
    { status: decision.allowed ? 200 : 423 },
  );
}

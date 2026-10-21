import { evaluateRisk } from "../../shared/risk.js";
import { TRADING_POLICY } from "../../shared/trading-config.js";
import { parseRiskInput } from "../../shared/validate.js";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ allowed: false, reasons: ["Request body must be valid JSON."], maxRiskAmount: 0 }, { status: 400 });
  }
  const parsed = parseRiskInput(body);
  if (!parsed.ok) return Response.json({ allowed: false, reasons: parsed.reasons, maxRiskAmount: 0 }, { status: 400 });

  // The browser cannot loosen the configured percentage or dollar loss cap.
  // dailyPnl/balance are still request inputs, so this endpoint is a demo
  // pre-trade check, NOT a broker-authoritative live trading authorization.
  const decision = evaluateRisk({
    ...parsed.value,
    riskPercent: TRADING_POLICY.riskPercent,
    dailyLossLimitPercent: TRADING_POLICY.dailyLossLimitPercent,
    dailyLossLimitAmount: TRADING_POLICY.dailyLossLimitUsd,
    maxOpenPositions: TRADING_POLICY.maxOpenPositions,
    liveEnabled: true,
  });
  return Response.json({
    ...decision,
    policy: {
      accountMode: TRADING_POLICY.accountMode,
      riskPercent: TRADING_POLICY.riskPercent,
      dailyLossLimitUsd: TRADING_POLICY.dailyLossLimitUsd,
      dailyProfitTargetUsd: TRADING_POLICY.dailyProfitTargetUsd,
      strategyMethod: TRADING_POLICY.strategyMethod,
    },
    note: "This endpoint blocks order authorization. Real execution is disabled; supplied balance/P&L are not broker-verified.",
  }, { status: decision.allowed ? 200 : 423 });
}

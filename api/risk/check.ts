import { evaluateRisk } from "../../server/risk.js";

type RiskInput = {
  balance: number;
  riskPercent: number;
  dailyLossLimitPercent: number;
  dailyPnl: number;
  openPositions: number;
  maxOpenPositions: number;
  liveEnabled: boolean;
};

const numericKeys = [
  "balance",
  "riskPercent",
  "dailyLossLimitPercent",
  "dailyPnl",
  "openPositions",
  "maxOpenPositions",
] as const;

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

  if (!body || typeof body !== "object") {
    return Response.json(
      { allowed: false, reasons: ["Request body must be a JSON object."], maxRiskAmount: 0 },
      { status: 400 },
    );
  }

  const input = body as Record<string, unknown>;
  if (numericKeys.some((key) => typeof input[key] !== "number" || !Number.isFinite(input[key]))) {
    return Response.json(
      { allowed: false, reasons: ["All numeric risk settings must be finite JSON numbers."], maxRiskAmount: 0 },
      { status: 400 },
    );
  }
  if (typeof input.liveEnabled !== "boolean") {
    return Response.json(
      { allowed: false, reasons: ["liveEnabled must be a boolean."], maxRiskAmount: 0 },
      { status: 400 },
    );
  }

  const decision = evaluateRisk(input as RiskInput);
  return Response.json(decision, { status: decision.allowed ? 200 : 422 });
}

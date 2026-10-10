import { evaluateRisk } from "../../shared/risk.js";
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
  const decision = evaluateRisk(parsed.value);
  return Response.json(decision, { status: decision.allowed ? 200 : 422 });
}

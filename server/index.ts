import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { evaluateRisk } from "../shared/risk.js";
import { parseRiskInput } from "../shared/validate.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
app.disable("x-powered-by");
app.use((_req, res, next) => { res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "no-referrer"); next(); });
app.use(cors({ origin: process.env.APP_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json({ limit: "16kb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, app: "BUTCHER TRADER", mode: "DEMO_ONLY", liveTradingEnabled: false }));
app.get("/api/config", (_req, res) => res.json({ mode: "DEMO_ONLY", liveTradingEnabled: false, note: "Market-data feed is public/read-only. Order placement is not implemented." }));

app.post("/api/risk/check", (req, res) => {
  const parsed = parseRiskInput(req.body);
  if (!parsed.ok) return res.status(400).json({ allowed: false, reasons: parsed.reasons, maxRiskAmount: 0 });
  const decision = evaluateRisk(parsed.value);
  return res.status(decision.allowed ? 200 : 422).json(decision);
});

app.use((_req, res) => res.status(404).json({ error: "Not found" }));
// Malformed JSON and oversized bodies get a JSON error, not an HTML stack page.
app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
  res.status(status).json({ allowed: false, reasons: [status === 500 ? "Internal error. Fail-closed: no trade." : "Request body must be valid JSON under 16 KB."], maxRiskAmount: 0 });
});
app.listen(port, () => console.log("BUTCHER TRADER API listening on :" + port + " (demo-only)"));

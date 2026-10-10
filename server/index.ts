import "dotenv/config";
import express from "express";
import cors from "cors";
import { evaluateRisk } from "./risk.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
app.disable("x-powered-by");
app.use(cors({ origin: process.env.APP_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json({ limit: "16kb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, app: "BUTCHER TRADER", mode: "DEMO_ONLY", liveTradingEnabled: false }));
app.get("/api/config", (_req, res) => res.json({ mode: "DEMO_ONLY", liveTradingEnabled: false, note: "Market-data feed is public/read-only. Order placement is not implemented." }));

app.post("/api/risk/check", (req, res) => {
  const body = req.body ?? {};
  const numbers = ["balance", "riskPercent", "dailyLossLimitPercent", "dailyPnl", "openPositions", "maxOpenPositions"];
  if (numbers.some(key => typeof body[key] !== "number" || !Number.isFinite(body[key]))) {
    return res.status(400).json({ allowed: false, reasons: ["All numeric risk settings must be finite JSON numbers."], maxRiskAmount: 0 });
  }
  if (typeof body.liveEnabled !== "boolean") {
    return res.status(400).json({ allowed: false, reasons: ["liveEnabled must be a boolean."], maxRiskAmount: 0 });
  }
  const decision = evaluateRisk({
    balance: body.balance, riskPercent: body.riskPercent,
    dailyLossLimitPercent: body.dailyLossLimitPercent, dailyPnl: body.dailyPnl,
    openPositions: body.openPositions, maxOpenPositions: body.maxOpenPositions,
    liveEnabled: body.liveEnabled,
  });
  return res.status(decision.allowed ? 200 : 422).json(decision);
});

app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.listen(port, () => console.log("BUTCHER TRADER API listening on :" + port + " (demo-only)"));

import "dotenv/config";
import express from "express";
import cors from "cors";
import { evaluateRisk } from "./risk.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
app.disable("x-powered-by");
app.use(cors({ origin: process.env.APP_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json({ limit: "16kb" }));
app.get("/api/health", (_req, res) => res.json({ ok: true, app: "BUTCHER TRADER", mode: "DEMO_ONLY" }));
app.post("/api/risk/check", (req, res) => {
  const body = req.body ?? {};
  const decision = evaluateRisk({
    balance: Number(body.balance ?? 1000), riskPercent: Number(body.riskPercent ?? 0.5),
    dailyLossLimitPercent: Number(body.dailyLossLimitPercent ?? 2), dailyPnl: Number(body.dailyPnl ?? 0),
    openPositions: Number(body.openPositions ?? 0), maxOpenPositions: Number(body.maxOpenPositions ?? 1), liveEnabled: body.liveEnabled === true,
  });
  res.status(decision.allowed ? 200 : 422).json(decision);
});
app.listen(port, () => console.log(`BUTCHER TRADER API listening on :${port} (demo-only)`));

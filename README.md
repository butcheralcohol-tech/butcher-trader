# BUTCHER TRADER

**Disciplined execution. Capital preservation first. Demo by default.**

Standalone React + TypeScript trading research dashboard. The frontend is built with Vite; local development uses Express, while Vercel deploys the API routes as serverless functions. Separate from Smartschool.

## Current milestone
- Dark cyberpunk black/crimson control deck.
- React + TypeScript + Vite frontend.
- Vercel serverless health and risk-check endpoints under `api/`.
- Demo-only mode; live order execution is not implemented.
- Risk gate: maximum 1% planned risk per trade, maximum 3% daily-loss cap (dashboard defaults to 2%), and at most one open position.
- Unit tests, environment template and secret-safe .gitignore.

## Deploy to Vercel
1. Push this repository to GitHub (the project is already hosted at https://github.com/butcheralcohol-tech/butcher-trader).
2. Sign in at https://vercel.com/new and import `butcheralcohol-tech/butcher-trader`.
3. Keep the project root as the repository root. Vercel should detect Vite; the checked-in `vercel.json` sets the build command to `npm run build` and output directory to `dist`.
4. Deploy. No Deriv API token or other secret is needed for the public read-only tick feed.
5. Verify `https://YOUR-DEPLOYMENT.vercel.app/api/health` returns JSON showing `"ok": true`, `"mode": "DEMO_ONLY"`, and `"liveTradingEnabled": false`.
6. Open the dashboard and run the risk check. Confirm the API status is online and that invalid/excessive risk settings are blocked.

The dashboard reads `VITE_DERIV_APP_ID` at build time and uses the public Deriv WebSocket feed. If you have a registered Deriv app ID, add `VITE_DERIV_APP_ID` in Vercel Project Settings → Environment Variables, then redeploy. The fallback app ID is for public feed access only.

## Run locally (Node.js 20+)
```bash
npm install
cp .env.example .env
npm run dev
```
Windows PowerShell: use `Copy-Item .env.example .env`. Frontend: http://localhost:5173. Local Express API: http://localhost:8787/api/health.

Checks: `npm test`, `npm run typecheck`, `npm run build`.

## Important deployment limits
Vercel Functions are request-driven serverless functions, not a persistent always-on trading worker. The market WebSocket currently runs in the user's browser, so it stops when the dashboard closes. Do not use this deployment as an autonomous trading bot. A future continuously running worker needs a separate persistent host, durable storage, monitoring and recovery.

## Deriv integration status
The dashboard currently subscribes to public/read-only Deriv tick data in the browser. Order placement is not implemented. Never put Deriv API tokens or other secrets in frontend code or commit secrets.

## Safety
Research starter, not financial advice or a profitable-strategy claim. Risk limits do not guarantee loss prevention. Live execution is intentionally absent. Before any future live mode: explicit server-side opt-in, authentication, instrument allowlists, broker-side checks, hard daily stop, audit logs, idempotent order handling, integration tests and extended demo forward-testing.

## Roadmap
1. Foundation and risk gate (this milestone).
2. Deriv public market data with reconnect handling and explicit feed state.
3. Candlestick history + strategy interfaces.
4. Backtesting with fees/slippage and out-of-sample evaluation.
5. Demo signal lifecycle and audit log.
6. Security review before any separately gated live mode.

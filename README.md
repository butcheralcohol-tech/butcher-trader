# BUTCHER TRADER

**Disciplined execution. Capital preservation first. Demo by default.**

Standalone React + TypeScript trading research dashboard. The frontend is built with Vite; local development uses Express, while Vercel deploys the API routes as serverless functions. Separate from Smartschool.

## Current milestone (v0.2)
- Dark cyberpunk black/crimson control deck: React + TypeScript + Vite.
- **Live Deriv market feed**: candle history plus streaming OHLC over the public read-only WebSocket, with automatic reconnect (exponential backoff), keep-alive pings, a stale-connection watchdog and an explicit status line. Timeframes 1m to 4h.
- **Candlestick chart** with EMA overlays on the Overview.
- **Strategy lab**: load up to 5,000 candles, run a backtest (fees, slippage, stop-first intrabar rule, one position at a time, same risk gate as live checks), see in-sample vs out-of-sample results with an overfitting verdict, equity curve, trade table, CSV export and a bounded parameter sweep ranked on in-sample data only.
- **Strategies** behind a small `Strategy` interface (`shared/strategy.ts`): EMA cross + RSI filter, RSI mean reversion.
- **Paper trading**: runs a strategy on the live feed with a virtual balance. Every signal goes through the risk gate; fills are simulated at the next candle open; each candle is processed exactly once; missed candles after a feed gap never trigger new entries. Audit log with CSV export, stored in the browser (localStorage).
- Demo-only: **live order execution is not implemented.**
- Risk gate: maximum 1% planned risk per trade, maximum 3% daily-loss cap (dashboard defaults to 2%), and at most one open position.
- Shared pure logic in `shared/` is used by the Express server, the Vercel functions and the browser, and is covered by unit tests (risk gate, indicators, simulator, backtester incl. a no-look-ahead test, candle parsing, feed reconnect behaviour, paper session).

## Architecture
```
shared/    pure TypeScript: risk gate, validation, indicators, strategies, simulator, backtester, paper session
server/    local Express API (dev)
api/       Vercel serverless functions (health, config, risk check)
src/       React app; src/lib/feed.ts is the Deriv WebSocket client
```

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

Checks: `npm test`, `npm run typecheck`, `npm run build` (or `npm run check` for tests + typecheck).

## Important deployment limits
Vercel Functions are request-driven serverless functions, not a persistent always-on trading worker. The market WebSocket and the paper trader run in the user's browser, so they stop when the dashboard closes. Do not use this deployment as an autonomous trading bot. A future continuously running worker needs a separate persistent host, durable storage, monitoring and recovery.

## Deriv integration status
The dashboard uses public/read-only Deriv market data (`ticks_history` with candles, plus a subscription) in the browser; no token is involved. Forex markets are closed on weekends, so only synthetic indices stream then. Order placement is not implemented. Never put Deriv API tokens or other secrets in frontend code or commit secrets.

## Safety
Research starter, not financial advice or a profitable-strategy claim. Risk limits do not guarantee loss prevention. Live execution is intentionally absent. Before any future live mode: explicit server-side opt-in, authentication, instrument allowlists, broker-side checks, hard daily stop, audit logs, idempotent order handling, integration tests and extended demo forward-testing.

## Roadmap
1. Foundation and risk gate. Done.
2. Deriv public market data with reconnect handling and explicit feed state. Done.
3. Candlestick history + strategy interfaces. Done.
4. Backtesting with fees/slippage and out-of-sample evaluation. Done.
5. Demo signal lifecycle and audit log. Done (browser-local; a server-side durable log is still to do).
6. Persistent worker for unattended paper trading (separate host, durable storage, monitoring).
7. Security review before any separately gated live mode.

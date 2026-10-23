# BUTCHER TRADER

**Disciplined execution. Capital preservation first. Demo by default.**

Standalone React + TypeScript trading research dashboard. The frontend is built with Vite; local development uses Express, while Vercel deploys the API routes as serverless functions. Separate from Smartschool.

## Current milestone (v0.2)
- Dark cyberpunk black/crimson control deck: React + TypeScript + Vite.
- **Live Deriv market feed**: candle history plus streaming OHLC over the public read-only WebSocket, with automatic reconnect (exponential backoff), keep-alive pings, a stale-connection watchdog and an explicit status line. Timeframes 1m to 4h.
- **Candlestick chart** with EMA overlays on the Overview.
- **Strategy lab**: load up to 5,000 candles, run a backtest (fees, slippage, stop-first intrabar rule, one position at a time, same risk gate as live checks), see in-sample vs out-of-sample results with an overfitting verdict, equity curve, trade table, CSV export and a bounded parameter sweep ranked on in-sample data only.
- **Strategy library** behind a small `Strategy` interface (`shared/strategy.ts`): EMA cross + RSI filter, RSI mean reversion, Donchian breakout, trend pullback, and Bollinger reversion.
- **Multi-strategy paper bot**: runs several selected strategies on the live feed at once (EMA cross + RSI, RSI reversion, Donchian breakout, trend pullback, Bollinger reversion). A configurable 50–100% directional consensus is required before an entry; conflicting/insufficient votes do nothing. Signals pass the risk gate; fills are simulated at the next candle open; each candle is processed exactly once; missed candles after a feed gap never trigger new entries. Audit log with CSV export, stored in the browser (localStorage).
- **Manual trading desk**: live candle chart and selectable market/timeframe, with virtual LONG/SHORT entries and manual exits. This is a simplified spot-style simulation, not a Deriv contract, and sends no broker orders.
- **Deriv OAuth 2.0**: server-side Authorization Code + PKCE flow, state validation, encrypted short-lived HTTP-only session cookie, connection status endpoint and logout. OAuth login does not place orders.
- Demo-only: the multi-strategy robot automatically executes trades in its virtual paper portfolio. **Real Deriv order execution is still not implemented and remains blocked.**
- Configured demo policy: $1,000 starting paper balance; 1% maximum planned risk per trade ($10 at a $1,000 balance); $20 absolute daily loss lock; $40 aspirational daily profit target that pauses new simulated entries when reached; at most one open position. The target is not guaranteed. Server API values fix these policy limits, but its P&L/balance inputs are still client-supplied and are not broker-authoritative.
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

The dashboard reads `VITE_DERIV_APP_ID` at build time for public market data. For OAuth, set `DERIV_OAUTH_CLIENT_ID` to the client ID shown for your registered Deriv OAuth app, `DERIV_OAUTH_REDIRECT_URI` to `https://butcherfx.vercel.app/deriv/callback`, and `SESSION_SECRET` to a randomly generated secret of at least 32 characters. `VITE_DERIV_OAUTH_CLIENT_ID` is only a public setup-screen hint; server-side OAuth uses the non-VITE variables. Redeploy after changing environment variables.

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
The dashboard uses public/read-only Deriv market data (`ticks_history` with candles, plus a subscription) in the browser; no token is involved. OAuth is implemented with PKCE and a short-lived encrypted HTTP-only cookie. The access token is not returned to browser JavaScript; the app does not yet use it to fetch account data or open an authenticated trading WebSocket. Manual trading is virtual only, and order placement to a broker is not implemented. Never put Deriv API tokens or other secrets in frontend code or commit secrets.

## Safety
Research starter, not financial advice or a profitable-strategy claim. Risk limits do not guarantee loss prevention. Real-account execution is intentionally absent. The current paper engine still uses consensus voting; `strategyMethod: "weighted"` is recorded in configuration but weighted signal scoring is not implemented yet. The current risk API is a server-side demo pre-trade check, not a broker-authoritative order guard. Before any future broker execution: implement authenticated Deriv REST/OTP/WebSocket account workflows, select and verify a demo account, reconcile broker-confirmed balance/positions/P&L, enforce the loss lock atomically before each order, instrument allowlists, proposal validation, explicit confirmation, durable audit logs, idempotent order handling, integration tests and extended demo forward-testing.

## Roadmap
1. Foundation and risk gate. Done.
2. Deriv public market data with reconnect handling and explicit feed state. Done.
3. Candlestick history + strategy interfaces. Done.
4. Backtesting with fees/slippage and out-of-sample evaluation. Done.
5. Demo signal lifecycle and audit log. Done (browser-local; a server-side durable log is still to do).
6. Deriv OAuth callback and encrypted HTTP-only session. Done; account data and authenticated trading WebSocket remain to do.
7. Implement and test broker demo orders with explicit confirmations and server-side risk controls.
8. Persistent worker for unattended paper trading (separate host, durable storage, monitoring).
9. Security review before any separately gated live mode.

## Daily maintenance and Deriv compatibility checks

- GitHub Actions runs `.github/workflows/deriv-daily-maintenance.yml` every day at 06:17 UTC (and can be started manually from Actions).
- The workflow connects to Deriv's public WebSocket and requests recent `R_100` candles, validating the response shape used by the market feed. A failed check marks the workflow failed; it does not change trading behavior.
- Compatible npm dependency updates are tested with `npm test`, `npm run typecheck`, and `npm run build`, then proposed in a pull request for review. No dependency update is auto-merged or automatically deployed.
- Dependabot checks npm dependencies daily and GitHub Actions versions weekly, proposing separate pull requests.

**Scope:** This is scheduled maintenance and API compatibility monitoring, not a system that can predict or automatically implement every Deriv API change. It does not rewrite the bot's strategies or risk limits, authenticate a trading account, or enable real-money trading. Review API-change alerts and update code deliberately when Deriv changes its protocol. Keep demo testing and the existing live-trading lock in place.


- Set the repository Actions variable `DERIV_APP_ID` to your registered public Deriv app ID if needed; the workflow otherwise uses the public-feed fallback ID. This check needs no account token.


## Authenticated Deriv demo execution milestone (in review)

- `POST /api/deriv/trade` is a server-side, authenticated **demo-only** order path. It decrypts the HTTP-only OAuth session, authorizes with Deriv, verifies the selected account is a virtual `VRTC` account, obtains broker balance/portfolio/profit history, applies a maximum 1% stake cap, pauses at the $20 daily loss cap or $40 aspirational profit target, permits at most one open contract, requests a broker proposal, and submits a buy only after the checks pass.
- `GET /api/deriv/trades` reconciles stored contract IDs against the broker's current open portfolio and closed profit table. A contract absent from both sources is explicitly marked `unreconciled`; it is never silently reported as closed.
- Both endpoints require `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Redis is used for durable idempotency keys, order records, and a per-account execution lock. Missing/unavailable durable storage fails closed.
- The order endpoint requires an `Idempotency-Key` request header (16–100 letters, digits, underscores or hyphens) to prevent a client retry from intentionally submitting the same request twice. If an order response times out, reconcile the account/history before any retry.
- Server-only settings: `DERIV_APP_ID`, optional secure `DERIV_TRADING_WS_URL`, OAuth settings, and the Upstash Redis REST credentials. Do not expose these as `VITE_*` values. Set the same environment variables in local development and Vercel, then redeploy.
- Test coverage added for the pure demo execution risk gate: non-demo accounts, >1% stake, daily loss/profit locks, concurrent contracts, and non-finite broker data.
- **Not yet live-verified:** repository tests/build, OAuth token authorization against the currently registered Deriv app, live broker proposal/buy/settlement, Upstash integration, and production deployment. The code must pass CI and be exercised on a Deriv virtual account before calling this milestone verified.
- Real-money trading remains hard-disabled. The $40 target is aspirational and is not a promise of profit. The $20 limit is an entry lock based on returned broker history; it cannot guarantee losses never exceed the limit, especially while a contract remains open or broker data is delayed.

## Real-money trading (locked by default)
Demo accounts work out of the box. A real Deriv account is refused unless **every** one of these holds:
1. Server env `ALLOW_REAL_TRADING=I_ACCEPT_REAL_MONEY_LOSSES` (exact value; `true` does not work).
2. The broker-verified login ID is in `REAL_ACCOUNT_ALLOWLIST`.
3. `REAL_MAX_STAKE` and `REAL_DAILY_LOSS_LIMIT` are set (no defaults). Effective stake is also capped at 1% of balance and the daily loss at 3% of balance, using Deriv's own balance and profit history.
4. At least 30 demo orders (`REAL_MIN_DEMO_ORDERS`, cannot be lower) have been broker-confirmed by this server.
5. The dashboard request carries the typed phrase `TRADE REAL MONEY`.
6. No open contract exists, and the per-account lock is held while all checks run.

`TRADING_HALTED=true` plus a redeploy stops every order, demo and real. Not yet verified against live Deriv: run on a demo account for weeks first; passing these gates is not a profit guarantee or a loss guarantee.

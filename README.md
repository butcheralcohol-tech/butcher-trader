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

## Real-money execution (off by default)

Demo accounts (`VRTC…`) trade with the normal risk rules. Real accounts (`CR…`) are refused unless **all** of these hold:

1. `ALLOW_REAL_TRADING=I_ACCEPT_REAL_MONEY_LOSSES` on the server
2. the account is in `REAL_ACCOUNT_ALLOWLIST`
3. `REAL_MAX_STAKE` and `REAL_DAILY_LOSS_LIMIT` are set
4. at least `REAL_MIN_DEMO_ORDERS` (30+) demo orders were confirmed
5. the dashboard user types `TRADE REAL MONEY`
6. stake ≤ min(1% of balance, `REAL_MAX_STAKE`), daily loss ≤ min(`REAL_DAILY_LOSS_LIMIT`, 3% of balance), and no contract already open

Kill switches: `TRADING_HALTED=true` (env) or the Redis key `butcher:halt`. Wallet accounts are unsupported. Trading carries real risk of loss; run demo for weeks first.

The **Broker trades** view lists real and demo contracts with a mode badge.

## Always-on worker (auto-execution with the browser closed)

Vercel functions cannot run continuously, so the robot loop runs as a small separate process (`npm run worker`, or `Dockerfile.worker`) on any always-on host (Railway, Render, Fly, a VPS).

- It pulls live Deriv candles, runs the paper strategy ensemble, saves its state to Upstash Redis, and sends each new entry to `/api/deriv/trade` with a service credential. Every server gate still applies (risk limits, one open contract, real-money gate, kill switches).
- State is saved **before** an order is sent, so a crash or restart can drop a signal but never send one twice. History is never replayed on start.
- **Start in dry-run** (`WORKER_ENABLED=false`): signals are logged but no order is sent. Check `GET /health`, then set `WORKER_ENABLED=true` on a demo account.
- Setup: on Vercel set `WORKER_SECRET` and `DERIV_WORKER_TOKEN`; on the worker host set `WORKER_API_BASE`, `WORKER_SECRET`, `WORKER_ACCOUNT_ID`, `UPSTASH_REDIS_REST_URL/TOKEN`. See `.env.example`.
- A real (`CR`/`ROT`) account also needs `WORKER_REAL_CONFIRMATION=TRADE REAL MONEY`, plus all the server-side real-money settings above.
- Stop it instantly with the kill switch (`butcher:halt` in Redis or `TRADING_HALTED=true`) or by stopping the process.

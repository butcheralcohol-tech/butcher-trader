# BUTCHER TRADER

**Disciplined execution. Capital preservation first. Demo by default.**

Standalone React + TypeScript trading research dashboard with an Express backend. Separate from Smartschool.

## Current milestone
- Dark cyberpunk black/crimson control deck.
- React + TypeScript + Vite frontend; Express API with schema validation.
- Demo-only mode; live order execution is not implemented.
- Risk gate: maximum 1% planned risk per trade, maximum 3% daily-loss cap (dashboard defaults to 2%), and consecutive-loss lockout.
- Unit tests, environment template and secret-safe .gitignore.

## Run locally (Node.js 20+)
```bash
npm install
cp .env.example .env
npm run dev
```
Windows PowerShell: use `Copy-Item .env.example .env`. Frontend: http://localhost:5173. API: http://localhost:8787/api/health.

Checks: `npm test`, `npm run typecheck`, `npm run build`.

## Deriv integration status
Market prices are **not connected yet**. Next milestone: Deriv WebSocket public market data, symbol discovery, reconnect handling, and explicit feed state. Never put API tokens in frontend code or commit secrets.

## Safety
Research starter, not financial advice or a profitable-strategy claim. Risk limits do not guarantee loss prevention. Live execution is intentionally absent. Before any future live mode: explicit server-side opt-in, authentication, instrument allowlists, broker-side checks, hard daily stop, audit logs, idempotent order handling, integration tests and extended demo forward-testing.

## Roadmap
1. Foundation and risk gate (this milestone).
2. Deriv public market data.
3. Candlestick history + strategy interfaces.
4. Backtesting with fees/slippage and out-of-sample evaluation.
5. Demo signal lifecycle and audit log.
6. Security review before any separately gated live mode.

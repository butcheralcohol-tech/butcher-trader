import type { DemoAccount, ExecutionRiskDecision } from "./demo-execution.js";

/** Phrase the user must type in the dashboard before the server will touch a real-money account. */
export const REAL_CONFIRM_PHRASE = "TRADE REAL MONEY";
/** Value ALLOW_REAL_TRADING must have on the server. Any other value (including "true") keeps real trading off. */
export const REAL_ENABLE_VALUE = "I_ACCEPT_REAL_MONEY_LOSSES";

export type RealEnv = {
  ALLOW_REAL_TRADING?: string; REAL_ACCOUNT_ALLOWLIST?: string; REAL_MAX_STAKE?: string;
  REAL_DAILY_LOSS_LIMIT?: string; REAL_MIN_DEMO_ORDERS?: string; TRADING_HALTED?: string;
};
export type RealConfig = { allowlist: string[]; maxStake: number; dailyLossLimit: number; minDemoOrders: number };

const positive = (v: string | undefined): number | null => { const n = Number(v); return v?.trim() && Number.isFinite(n) && n > 0 ? n : null; };

/** Global kill switch: halts every order, demo and real. */
export const isHalted = (env: RealEnv): boolean => ["1", "true", "yes", "on"].includes((env.TRADING_HALTED ?? "").trim().toLowerCase());

/** Returns the real-money configuration, or the reasons it is not enabled. No defaults for money limits: they must be set deliberately. */
export function loadRealConfig(env: RealEnv): { ok: true; config: RealConfig } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  if (env.ALLOW_REAL_TRADING !== REAL_ENABLE_VALUE) reasons.push("Real-money trading is not enabled on the server.");
  const allowlist = (env.REAL_ACCOUNT_ALLOWLIST ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (!allowlist.length || allowlist.some(id => !/^(CR|MF|MLT|MX)\d+$/.test(id))) reasons.push("REAL_ACCOUNT_ALLOWLIST must list the exact real account login ID(s).");
  const maxStake = positive(env.REAL_MAX_STAKE), dailyLossLimit = positive(env.REAL_DAILY_LOSS_LIMIT);
  if (maxStake === null) reasons.push("REAL_MAX_STAKE must be set to a positive amount.");
  if (dailyLossLimit === null) reasons.push("REAL_DAILY_LOSS_LIMIT must be set to a positive amount.");
  const minDemo = env.REAL_MIN_DEMO_ORDERS === undefined || env.REAL_MIN_DEMO_ORDERS === "" ? 30 : Number(env.REAL_MIN_DEMO_ORDERS);
  if (!Number.isInteger(minDemo) || minDemo < 30) reasons.push("REAL_MIN_DEMO_ORDERS cannot be below 30.");
  return reasons.length || maxStake === null || dailyLossLimit === null
    ? { ok: false, reasons }
    : { ok: true, config: { allowlist, maxStake, dailyLossLimit, minDemoOrders: minDemo } };
}

export type RealRiskInput = {
  account: DemoAccount; stake: number; dailyNetPnl: number; openContracts: number; maxOpenContracts: number;
  config: RealConfig; confirmation: unknown; demoOrdersConfirmed: number;
};

/** Fail-closed gate for a broker-verified REAL account. Every rule must pass; the effective caps are the stricter of the env limits and 1% stake / 3% daily loss. */
export function evaluateRealExecutionRisk(input: RealRiskInput): ExecutionRiskDecision {
  const { account, config } = input, reasons: string[] = [];
  const numeric = [account.balance, input.stake, input.dailyNetPnl, input.openContracts, input.maxOpenContracts, input.demoOrdersConfirmed];
  if (!numeric.every(Number.isFinite)) reasons.push("Risk inputs must be finite.");
  if (account.is_virtual !== 0 || !/^(CR|MF|MLT|MX)\d+$/.test(account.loginid)) reasons.push("This path is only for a broker-verified real account.");
  if (!config.allowlist.includes(account.loginid)) reasons.push("This account is not on the real-trading allowlist.");
  if (input.confirmation !== REAL_CONFIRM_PHRASE) reasons.push(`Type "${REAL_CONFIRM_PHRASE}" in the dashboard to confirm real-money orders.`);
  if (input.demoOrdersConfirmed < config.minDemoOrders) reasons.push(`Only ${input.demoOrdersConfirmed} demo orders have been broker-confirmed; ${config.minDemoOrders} are required first.`);
  if (!account.currency || !/^[A-Z]{3,5}$/.test(account.currency)) reasons.push("Broker account currency is invalid.");
  if (!(account.balance > 0)) reasons.push("Broker-reported balance must be positive.");
  const lossCap = Math.min(config.dailyLossLimit, account.balance * 0.03);
  if (input.dailyNetPnl <= -lossCap) reasons.push("Broker-confirmed daily loss cap reached; real entries are locked.");
  if (input.openContracts !== 0) reasons.push("An open contract already exists; one at a time.");
  if (input.maxOpenContracts !== 1) reasons.push("Maximum concurrent open contracts is fixed at one.");
  const maxStake = Math.floor(Math.min(account.balance * 0.01, config.maxStake) * 100) / 100;
  if (!Number.isFinite(input.stake) || input.stake <= 0 || input.stake > maxStake) reasons.push(`Stake exceeds the real-account cap of ${maxStake.toFixed(2)} ${account.currency}.`);
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], maxStake };
}

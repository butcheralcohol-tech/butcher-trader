import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { OAUTH_COOKIE, decryptSession, parseCookies } from "../../shared/oauth-session.js";
import { evaluateDemoExecutionRisk, type DemoAccount } from "../../shared/demo-execution.js";

type DerivReply = {
  req_id?: number;
  error?: { code?: string; message?: string };
  balance?: Record<string, unknown>;
  proposal?: { id?: string; ask_price?: number; payout?: number; longcode?: string };
  contracts_for?: { available?: Array<Record<string, unknown>> };
  buy?: { contract_id?: number; buy_price?: number; transaction_id?: number };
};

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(body));
};

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

async function redisCommand<T>(command: (string | number)[]): Promise<T | null> {
  const config = redisConfig();
  if (!config) throw new Error("Durable risk storage is not configured; orders are disabled.");
  const response = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Durable risk storage unavailable; orders are disabled.");
  const result = (await response.json()) as { result?: T; error?: string };
  if (result.error) throw new Error("Durable risk storage rejected the request.");
  return result.result ?? null;
}

async function acquireLock(key: string): Promise<string | null> {
  const owner = randomUUID();
  return (await redisCommand<string>(["SET", key, owner, "NX", "EX", 120])) === "OK" ? owner : null;
}

async function releaseLock(key: string, owner: string): Promise<void> {
  await redisCommand<number>([
    "EVAL",
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    key,
    owner,
  ]);
}

/**
 * Opens an authenticated WebSocket to Deriv using the OTP-URL flow.
 *
 * Authentication happens before connect: POST to the OTP endpoint with the
 * Bearer token (plus Deriv-App-ID for PAT), then connect to the returned
 * wss:// URL directly. No `authorize` message is sent after connect.
 *
 * The OTP is valid for 120 seconds and single-use; connect immediately.
 */
async function brokerRequest(
  token: string,
  accountId: string,
  payloads: Record<string, unknown>[],
): Promise<DerivReply[]> {
  const appId = process.env.DERIV_APP_ID?.trim();
  if (!appId || !/^\d+$/.test(appId)) {
    throw new Error("Server-side DERIV_APP_ID is not configured.");
  }

  const otpResponse = await fetch(
    `https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Deriv-App-ID": appId,
      },
      signal: AbortSignal.timeout(8000),
    },
  );

  if (!otpResponse.ok) {
    const body = await otpResponse.text();
    throw new Error(`Deriv OTP request rejected (${otpResponse.status}). ${body.slice(0, 200)}`);
  }

  const otpPayload = (await otpResponse.json()) as { data?: { url?: string } };
  const wsUrl = otpPayload.data?.url;
  if (!wsUrl || !wsUrl.startsWith("wss://")) {
    throw new Error("Deriv OTP response did not contain a secure WebSocket URL.");
  }

  const ws = new WebSocket(wsUrl);
  const replies: DerivReply[] = [];

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Deriv WebSocket connection timed out.")), 8000);
      ws.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.once("error", () => {
        clearTimeout(timeout);
        reject(new Error("Deriv WebSocket connection failed."));
      });
    });

    let nextId = 1;
    const send = (payload: Record<string, unknown>) =>
      new Promise<DerivReply>((resolve, reject) => {
        const req_id = nextId++;
        const timeout = setTimeout(() => {
          ws.off("message", onMessage);
          reject(new Error("Deriv response timed out; order status must be reconciled before retry."));
        }, 10000);

        const onMessage = (data: WebSocket.RawData) => {
          let message: DerivReply;
          try {
            message = JSON.parse(data.toString()) as DerivReply;
          } catch {
            return;
          }
          if (message.req_id !== req_id) return;
          clearTimeout(timeout);
          ws.off("message", onMessage);
          if (message.error) {
            reject(new Error(`Deriv rejected request (${message.error.code || "API_ERROR"}).`));
          } else {
            resolve(message);
          }
        };

        ws.on("message", onMessage);
        ws.send(JSON.stringify({ ...payload, req_id }), (error) => {
          if (error) {
            clearTimeout(timeout);
            ws.off("message", onMessage);
            reject(new Error("Could not send request to Deriv."));
          }
        });
      });

    for (const payload of payloads) {
      replies.push(await send(payload));
    }

    return replies;
  } finally {
    try {
      ws.close();
    } catch {
      /* best effort */
    }
  }
}

function todayStartUnix(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function numberField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    json(res, 405, { error: "Method not allowed." });
    return;
  }

  const secret = process.env.SESSION_SECRET ?? "";
  const cookies = parseCookies(typeof req.headers.cookie === "string" ? req.headers.cookie : null);
  const session = decryptSession(cookies[OAUTH_COOKIE], secret);
  if (!session) {
    json(res, 401, { error: "Connect Deriv again before placing a demo order." });
    return;
  }

  const requestId = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : "";
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) {
    json(res, 400, { error: "A unique Idempotency-Key (16–100 safe characters) is required." });
    return;
  }

  let body: Record<string, unknown>;
  const parsedBody = (req as IncomingMessage & { body?: unknown }).body;
  if (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)) {
    body = parsedBody as Record<string, unknown>;
  } else {
    let raw = "";
    try {
      for await (const chunk of req) {
        raw += chunk.toString();
        if (raw.length > 8192) {
          json(res, 413, { error: "Request body too large." });
          return;
        }
      }
    } catch {
      json(res, 400, { error: "Unable to read request." });
      return;
    }
    try {
      body = JSON.parse(raw || "{}") as Record<string, unknown>;
    } catch {
      json(res, 400, { error: "Invalid JSON." });
      return;
    }
  }

  const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
  if (!accountId || !/^[A-Z]{2,4}\d+$/i.test(accountId)) {
    json(res, 400, { error: "A valid accountId is required." });
    return;
  }

  const symbol = typeof body.symbol === "string" ? body.symbol : "";
  const contractType = typeof body.contractType === "string" ? body.contractType : "";
  const duration = body.duration;
  const durationUnit = body.durationUnit;
  const stake = numberField(body.stake);
  const barrier = body.barrier;
  const takeProfit = numberField(body.takeProfit);
  const stopLoss = numberField(body.stopLoss);

  const supportedContractTypes = new Set([
    "CALL", "PUT", "DIGITUNDER", "DIGITOVER", "DIGITMATCH", "DIGITDIFF", "DIGITEVEN", "DIGITODD", "MULTUP", "MULTDOWN",
  ]);
  const multiplierContract = contractType === "MULTUP" || contractType === "MULTDOWN";
  const digitBarrierContract = ["DIGITUNDER", "DIGITOVER", "DIGITMATCH", "DIGITDIFF"].includes(contractType);
  const barrierContract = digitBarrierContract || ["ONETOUCH", "NOTOUCH", "RANGE", "UPORDOWN", "EXPIRYRANGE", "EXPIRYMISS"].includes(contractType);
  const durationUnits = new Set(["t", "s", "m", "h", "d"]);
  const validDuration = Number.isInteger(duration) && Number(duration) >= 1 && Number(duration) <= 365 &&
    typeof durationUnit === "string" && durationUnits.has(durationUnit);
  const barrierText = typeof barrier === "string" || typeof barrier === "number" ? String(barrier) : "";
  const barrier2 = body.barrier2;
  const barrier2Text = typeof barrier2 === "string" || typeof barrier2 === "number" ? String(barrier2) : "";
  const validBarrier = !barrierContract || (barrierText.length > 0 && barrierText.length <= 24 &&
    /^-?\d+(?:\.\d+)?$/.test(barrierText));
  const validSecondBarrier = contractType !== "RANGE" || (barrier2Text.length > 0 && barrier2Text.length <= 24 &&
    /^-?\d+(?:\.\d+)?$/.test(barrier2Text) && Number(barrier2Text) !== Number(barrierText));

  // Digit Under/Over barrier validation.
  // Deriv's contract_type enum lists DIGITOVER and DIGITUNDER separately; the
  // legacy doc's "Over uses DIGITMATCH" line is an error and is ignored here.
  // Under with barrier 0 and Over with barrier 9 are mathematically impossible,
  // so reject them before the broker sees the proposal.
  const validDigitBarrier = !digitBarrierContract || (() => {
    if (!/^\d$/.test(barrierText)) return false;
    const n = Number(barrierText);
    if (n > 9) return false;
    if (contractType === "DIGITUNDER" && n === 0) return false;
    if (contractType === "DIGITOVER" && n === 9) return false;
    return true;
  })();

  if (!/^[A-Z0-9_]{2,32}$/.test(symbol) || !supportedContractTypes.has(contractType) ||
      !validDuration || !validBarrier || !validSecondBarrier || !validDigitBarrier ||
      stake === null || stake <= 0 ||
      (takeProfit !== null && takeProfit <= 0) || (stopLoss !== null && stopLoss <= 0) ||
      ((takeProfit !== null || stopLoss !== null) && !multiplierContract)) {
    json(res, 400, {
      error:
        "Invalid contract parameters. Contract availability and exact duration rules are verified against Deriv before a proposal is sent. TP/SL is currently supported only for multiplier contracts.",
    });
    return;
  }

  let account: DemoAccount | null = null;

  try {
    const authReplies = await brokerRequest(session.accessToken, accountId, [
      { balance: 1 },
      { portfolio: 1 },
      { profit_table: 1, description: 1, limit: 500, offset: 0, sort: "DESC" },
    ]);

    const balanceReply = authReplies[0].balance as Record<string, unknown> | undefined;
    const brokerBalance = numberField(balanceReply?.balance);
    const currency = typeof balanceReply?.currency === "string" ? balanceReply.currency : "";

    if (brokerBalance === null || !currency) {
      throw new Error("Could not verify the broker balance and currency.");
    }

    if (!/^VRTC\d+$/i.test(accountId)) {
      json(res, 403, { error: "This endpoint only permits broker-verified Deriv virtual accounts." });
      return;
    }

    account = {
      loginid: accountId,
      is_virtual: 1,
      currency,
      balance: brokerBalance,
    };

    const portfolio = authReplies[1] as unknown as { portfolio?: { contracts?: Array<unknown> } };
    const openContracts = Array.isArray(portfolio.portfolio?.contracts) ? portfolio.portfolio.contracts.length : 0;

    const profits = authReplies[2] as unknown as { profit_table?: { transactions?: Array<Record<string, unknown>> } };
    const transactions = profits.profit_table?.transactions;
    if (!Array.isArray(transactions)) throw new Error("Broker profit history is unavailable; fail closed.");
    if (transactions.length >= 500) {
      throw new Error("Broker history reached the query limit; risk totals may be incomplete, so demo orders are disabled.");
    }
    if (transactions.some((transaction) =>
      numberField(transaction.sell_time) === null ||
      numberField(transaction.profit) === null ||
      typeof (transaction.underlying ?? transaction.symbol) !== "string"
    )) {
      throw new Error("Broker history is missing timestamps, P&L, or market identifiers; risk accounting is incomplete, so demo orders are disabled.");
    }

    const today = todayStartUnix();
    const dailyNetPnl = transactions.reduce((sum, transaction) => {
      const sellTime = numberField(transaction.sell_time);
      const profit = numberField(transaction.profit);
      return sellTime !== null && sellTime >= today && profit !== null ? sum + profit : sum;
    }, 0);

    const marketTransactions = transactions.filter((transaction) =>
      String(transaction.underlying ?? transaction.symbol ?? "") === symbol
    );
    if (marketTransactions.some((transaction) =>
      numberField(transaction.sell_time) === null || numberField(transaction.profit) === null
    )) {
      throw new Error("Market-specific broker history is incomplete; demo orders are disabled.");
    }

    const marketNetPnl = marketTransactions.reduce((sum, transaction) => {
      const sellTime = numberField(transaction.sell_time);
      const profit = numberField(transaction.profit);
      return sellTime !== null && sellTime >= today && profit !== null ? sum + profit : sum;
    }, 0);

    const sessionStart = Math.floor(Date.now() / 1000) - 4 * 60 * 60;
    const sessionNetPnl = transactions.reduce((sum, transaction) => {
      const sellTime = numberField(transaction.sell_time);
      const profit = numberField(transaction.profit);
      return sellTime !== null && sellTime >= sessionStart && profit !== null ? sum + profit : sum;
    }, 0);

    const configuredLoss = Number(process.env.DERIV_DAILY_LOSS_LIMIT_USD ?? 20);
    const configuredTarget = Number(process.env.DERIV_DAILY_PROFIT_TARGET_USD ?? 40);
    const configuredMarketLimits = (() => {
      try {
        const raw = process.env.DERIV_MARKET_LOSS_LIMITS_JSON;
        const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const value = parsed[symbol];
        return typeof value === "number" && Number.isFinite(value) ? value : configuredLoss;
      } catch {
        throw new Error("DERIV_MARKET_LOSS_LIMITS_JSON is invalid; demo orders are disabled.");
      }
    })();
    const configuredSessionLoss = Number(process.env.DERIV_SESSION_LOSS_LIMIT_USD ?? configuredLoss);

    const risk = evaluateDemoExecutionRisk({
      account, stake, dailyNetPnl, marketNetPnl, sessionNetPnl,
      dailyLossLimitUsd: configuredLoss, marketLossLimitUsd: configuredMarketLimits,
      sessionLossLimitUsd: configuredSessionLoss, dailyProfitTargetUsd: configuredTarget,
      riskPercent: 1, openContracts, maxOpenContracts: 1,
    });

    if (!risk.allowed) {
      json(res, 423, { error: "Risk checks blocked this order.", reasons: risk.reasons, maxStake: risk.maxStake, dailyNetPnl });
      return;
    }

    const storagePrefix = `butcher:demo:${account.loginid}`;
    const idempotencyKey = storagePrefix + ":idempotency:" + requestId;
    const previous = await redisCommand<string>(["GET", idempotencyKey]);
    if (previous) {
      json(res, 409, { ...JSON.parse(previous), replayed: true, message: "This request key was already used; reconcile broker history before retrying." });
      return;
    }

    const lockKey = storagePrefix + ":execution-lock";
    const lockOwner = await acquireLock(lockKey);
    if (!lockOwner) {
      json(res, 423, { error: "Another order is being processed. Reconcile order history before retrying." });
      return;
    }

    try {
      const markerValue = JSON.stringify({ status: "pending_reconciliation", requestId, symbol, contractType, stake, createdAt: new Date().toISOString() });
      const reserved = await redisCommand<string>(["SET", idempotencyKey, markerValue, "NX", "EX", 86400]);
      if (reserved !== "OK") {
        json(res, 409, { error: "This idempotency key has already been reserved; reconcile broker history before retrying." });
        return;
      }

      // contracts_for is a market-data endpoint; currency and product_type
      // were removed in the current API. Only the symbol is needed.
      const availabilityReply = await brokerRequest(session.accessToken, accountId, [
        { contracts_for: symbol },
      ]);
      const available = availabilityReply[0]?.contracts_for?.available;
      if (!Array.isArray(available) || !available.some((item) => item.contract_type === contractType)) {
        json(res, 422, { error: "This contract type is not available for the selected market/account. Refresh contract discovery and choose an available type." });
        return;
      }

      const meta = available.find((item) => item.contract_type === contractType)!;
      const minDuration = typeof meta.min_contract_duration === "string" ? meta.min_contract_duration : "";
      const maxDuration = typeof meta.max_contract_duration === "string" ? meta.max_contract_duration : "";
      const durationSeconds: Record<string, number> = { t: 0, s: 1, m: 60, h: 3600, d: 86400 };
      const unitSeconds = durationSeconds[String(durationUnit)] ?? -1;
      const toSeconds = (value: string): number | null => {
        const match = value.match(/^(\d+)(t|s|m|h|d)$/);
        return match ? Number(match[1]) * (durationSeconds[match[2]] || 1) : null;
      };
      const minSeconds = toSeconds(minDuration);
      const maxSeconds = toSeconds(maxDuration);
      const requestedSeconds = Number(duration) * (String(durationUnit) === "t" ? 1 : unitSeconds);
      if (unitSeconds < 0 || (minSeconds !== null && requestedSeconds < minSeconds) ||
          (maxSeconds !== null && requestedSeconds > maxSeconds)) {
        json(res, 422, { error: "Requested duration is outside the broker-advertised range for this contract." });
        return;
      }

      // symbol was renamed to underlying_symbol in the current API.
      // loginid and barrier_range were removed from the request.
      const proposalPayload: Record<string, unknown> = {
        proposal: 1,
        amount: stake,
        basis: "stake",
        contract_type: contractType,
        currency: account.currency,
        duration: Number(duration),
        duration_unit: durationUnit,
        underlying_symbol: symbol,
      };
      if (barrierContract) proposalPayload.barrier = barrierText;
      if (contractType === "RANGE") proposalPayload.barrier2 = barrier2Text;
      if (multiplierContract) {
        proposalPayload.multiplier = 10;
        if (takeProfit !== null || stopLoss !== null) {
          proposalPayload.limit_order = {
            ...(takeProfit !== null ? { take_profit: takeProfit } : {}),
            ...(stopLoss !== null ? { stop_loss: stopLoss } : {}),
          };
        }
      }

      const proposal = await brokerRequest(session.accessToken, accountId, [proposalPayload]);
      const proposalData = proposal[0]?.proposal;
      if (!proposalData?.id || numberField(proposalData.ask_price) === null) {
        throw new Error("Broker proposal was incomplete; no buy request was sent.");
      }

      // loginid was removed from the buy request in the current API.
      const buy = await brokerRequest(session.accessToken, accountId, [
        { buy: String(proposalData.id), price: stake },
      ]);
      const receipt = buy[0]?.buy;
      if (!receipt?.contract_id || numberField(receipt.buy_price) === null) {
        throw new Error("Broker buy receipt was not confirmed. Reconcile account history before retrying.");
      }

      const result = {
        status: "open",
        mode: "demo",
        account: account.loginid,
        contractId: receipt.contract_id,
        transactionId: receipt.transaction_id ?? null,
        symbol,
        contractType,
        barrier: barrier ?? null,
        duration: Number(duration),
        durationUnit,
        takeProfit: takeProfit ?? null,
        stopLoss: stopLoss ?? null,
        stake: receipt.buy_price,
        currency: account.currency,
        proposalPayout: proposalData.payout ?? null,
        longcode: proposalData.longcode ?? null,
        dailyNetPnlAtEntry: dailyNetPnl,
        submittedAt: new Date().toISOString(),
        brokerConfirmed: true,
        liveTradingEnabled: false,
      };

      await redisCommand(["SET", `${storagePrefix}:idempotency:${requestId}`, JSON.stringify(result), "EX", 86400]);
      await redisCommand(["SET", `${storagePrefix}:contract:${receipt.contract_id}`, JSON.stringify(result), "EX", 604800]);
      json(res, 201, result);
    } finally {
      await releaseLock(lockKey, lockOwner).catch(() => null);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Demo execution failed closed.";
    json(res, 503, {
      error: message,
      noRetryUntilReconciled: message.includes("timed out") || message.includes("status must be reconciled"),
      liveTradingEnabled: false,
    });
  }
}

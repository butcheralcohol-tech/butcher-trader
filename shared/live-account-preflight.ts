export type DerivOptionsAccount = {
  account_id: string;
  account_type?: string;
  currency?: string;
  status?: string;
};

export type LivePreflightInput = {
  account: DerivOptionsAccount;
  tokenScopes: string[];
  otpUrl: string;
  appId?: string;
  maxOrdersPerRun: number;
  maxStake: number;
  accountBalance: number;
};

export type LivePreflightDecision = { allowed: boolean; reasons: string[] };

/**
 * Conservative preflight checks for a real Deriv Options account.
 * This validates supplied metadata; it does not prove token scopes or balance
 * unless those values came from authenticated broker responses.
 */
export function evaluateLivePreflight(input: LivePreflightInput): LivePreflightDecision {
  const reasons: string[] = [];
  const accountId = input.account.account_id.trim().toUpperCase();
  const type = (input.account.account_type ?? "").trim().toLowerCase();
  const currency = (input.account.currency ?? "").trim().toUpperCase();
  const scopes = new Set(input.tokenScopes.map((scope) => scope.trim().toLowerCase()));

  if (!/^CR\d+$/.test(accountId) || /^CRW|^VRW/.test(accountId)) {
    reasons.push(
      "Select a real trading account ID beginning with CR; Wallet accounts are not eligible.",
    );
  }

  if (type && /wallet/.test(type)) {
    reasons.push("Wallet account types cannot place Options trades.");
  }

  if (!currency || !/^[A-Z]{3,5}$/.test(currency)) {
    reasons.push("Broker-reported account currency is missing or invalid.");
  }

  if (!scopes.has("trade")) reasons.push("Token must have the Trade scope.");
  if (!scopes.has("read")) {
    reasons.push("Token must have the Read scope for account and result reconciliation.");
  }
  if (scopes.has("payments") || scopes.has("admin")) {
    reasons.push("Use a least-privilege token without Payments or Admin scopes.");
  }

  if (!Number.isFinite(input.accountBalance) || input.accountBalance <= 0) {
    reasons.push("A positive broker-confirmed account balance is required.");
  }

  if (
    !Number.isFinite(input.maxStake) ||
    input.maxStake <= 0 ||
    input.maxStake > input.accountBalance * 0.01
  ) {
    reasons.push(
      "First-run stake must be positive and no greater than 1% of broker-confirmed equity.",
    );
  }

  if (input.maxOrdersPerRun !== 1) {
    reasons.push("Initial supervised real-money run must be limited to one order.");
  }

  let url: URL | null = null;
  try {
    url = new URL(input.otpUrl);
  } catch {
    /* rejected below */
  }
  if (
    !url ||
    url.protocol !== "wss:" ||
    url.hostname !== "api.derivws.com" ||
    !/^\/trading\/v1\/options\/ws\/real\/?$/.test(url.pathname) ||
    !url.searchParams.has("otp")
  ) {
    reasons.push(
      "OTP URL must be broker-issued, secure, and point to the real Options WebSocket environment.",
    );
  }

  if (input.appId !== undefined && !/^\d+$/.test(input.appId.trim())) {
    reasons.push("Deriv App ID must be numeric when supplied.");
  }

  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)] };
}

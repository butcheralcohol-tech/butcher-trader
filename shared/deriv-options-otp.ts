/**
 * Deriv Options API authenticated WebSocket bootstrap.
 * OTP URLs are secrets: keep this helper server-side and never log or return
 * the resulting URL to the browser. The OTP is single-use and expires quickly.
 */
export type DerivOptionsAccount = {
  account_id: string;
  account_type: "demo" | "real" | string;
  currency: string;
  status?: string;
  balance?: number;
};

export async function getDerivOptionsAccounts(accessToken: string): Promise<DerivOptionsAccount[]> {
  if (!accessToken) throw new Error("Deriv authorization is required.");
  const response = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Deriv account lookup failed (HTTP ${response.status}).`);
  const payload = await response.json() as { data?: unknown };
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return rows.filter((row): row is DerivOptionsAccount => {
    if (!row || typeof row !== "object") return false;
    const item = row as Record<string, unknown>;
    return typeof item.account_id === "string" &&
      typeof item.account_type === "string" &&
      typeof item.currency === "string";
  });
}

export async function getDerivOptionsOtpUrl(
  accessToken: string,
  accountId: string,
  appId?: string,
): Promise<string> {
  if (!accessToken) throw new Error("Deriv authorization is required.");
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(accountId)) throw new Error("Invalid Deriv Options account ID.");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  // OAuth bearer tokens do not require Deriv-App-ID; PAT callers must supply it.
  if (appId?.trim()) headers["Deriv-App-ID"] = appId.trim();
  const response = await fetch(
    `https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
    { method: "POST", headers, signal: AbortSignal.timeout(10000) },
  );
  if (!response.ok) throw new Error(`Deriv OTP request failed (HTTP ${response.status}).`);
  const payload = await response.json() as { data?: { url?: unknown } };
  const url = payload.data?.url;
  if (typeof url !== "string") throw new Error("Deriv OTP response did not include a WebSocket URL.");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Deriv returned an invalid OTP WebSocket URL."); }
  if (parsed.protocol !== "wss:" || parsed.hostname !== "api.derivws.com" ||
      !/^\/trading\/v1\/options\/ws\/(demo|real)$/.test(parsed.pathname) ||
      !parsed.searchParams.has("otp")) {
    throw new Error("Deriv returned an unexpected authenticated WebSocket endpoint.");
  }
  return url;
}

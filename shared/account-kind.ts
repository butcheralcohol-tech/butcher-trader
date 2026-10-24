export type AccountKind = "demo" | "real" | "unsupported";

/** Classify a Deriv Options account by its ID. Wallet IDs (CRW/VRW...) and anything unfamiliar are unsupported, so they can never reach an order path. */
export function classifyAccount(accountId: string): AccountKind {
  const id = accountId.trim().toUpperCase();
  if (/^(VRTC|DOT)\d+$/.test(id)) return "demo";
  if (/^(CR|ROT)\d+$/.test(id)) return "real";
  return "unsupported";
}

/** Environment a broker-issued OTP URL points at, e.g. wss://api.derivws.com/trading/v1/options/ws/real?otp=... */
export function otpEnvironment(url: string): "demo" | "real" | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "wss:" || u.hostname !== "api.derivws.com") return null;
    if (/^\/trading\/v1\/options\/ws\/demo\/?$/.test(u.pathname)) return "demo";
    if (/^\/trading\/v1\/options\/ws\/real\/?$/.test(u.pathname)) return "real";
  } catch { /* invalid URL */ }
  return null;
}

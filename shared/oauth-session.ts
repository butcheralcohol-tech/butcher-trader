import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const OAUTH_COOKIE = "butcher_deriv_session";
export const OAUTH_STATE_COOKIE = "butcher_deriv_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "butcher_deriv_pkce_verifier";
export const OAUTH_COOKIE_TTL_SECONDS = 60 * 60;

export type DerivSession = { accessToken: string; expiresAt: number };

function keyFromSecret(secret: string): Buffer {
  if (secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return createHash("sha256").update(secret, "utf8").digest();
}

export function randomUrlSafe(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function parseCookies(header: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    try {
      result[name] = decodeURIComponent(value);
    } catch {
      /* ignore malformed cookie */
    }
  }
  return result;
}

export function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(name: string): string {
  return cookie(name, "", 0);
}

export function encryptSession(session: DerivSession, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSession(value: string | undefined, secret: string): DerivSession | null {
  if (!value || value.length > 3500) return null;
  try {
    const parts = value.split(".");
    if (parts.length !== 3) return null;
    const [ivPart, tagPart, encryptedPart] = parts;
    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    const encrypted = Buffer.from(encryptedPart, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plain) as Partial<DerivSession>;
    if (
      typeof parsed.accessToken !== "string" ||
      !parsed.accessToken ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) {
      return null;
    }
    return { accessToken: parsed.accessToken, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Invite and password-reset tokens (docs/09-security.md §2).
 *
 * The raw token exists only in the email link. The database stores its
 * SHA-256, so a stolen database dump cannot be replayed into account takeover.
 * SHA-256 rather than argon2 is correct here: the token is 32 bytes of CSPRNG
 * output, so there is no low-entropy guess for a slow hash to defend against.
 */

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

export interface IssuedToken {
  /** Goes in the emailed link. Never stored, never logged. */
  raw: string;
  /** Goes in `password_reset_tokens.token_hash`. */
  hash: string;
  expiresAt: Date;
}

export function issueToken(kind: "invite" | "reset"): IssuedToken {
  const raw = randomBytes(32).toString("base64url");
  return {
    raw,
    hash: hashToken(raw),
    expiresAt: new Date(Date.now() + (kind === "invite" ? INVITE_TTL_MS : RESET_TTL_MS)),
  };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Constant-time compare, so a token cannot be recovered byte by byte. */
export function tokenMatches(rawCandidate: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashToken(rawCandidate), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

export function buildInviteUrl(appUrl: string, token: string): string {
  return `${appUrl}/reset-password?token=${encodeURIComponent(token)}&kind=invite`;
}

export function buildResetUrl(appUrl: string, token: string): string {
  return `${appUrl}/reset-password?token=${encodeURIComponent(token)}&kind=reset`;
}

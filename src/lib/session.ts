import { encode, decode } from "@auth/core/jwt";

/**
 * Reads `process.env` directly instead of importing `./env`.
 *
 * This module is imported by Next.js middleware, which runs on the Edge
 * runtime. Pulling in the full env schema there would drag the database and
 * mail configuration into the Edge bundle and fail at init over variables the
 * Edge runtime has no use for.
 */
const isProd = process.env.NODE_ENV === "production";

function authSecret(): string {
  const secret = process.env["AUTH_SECRET"];
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  return secret;
}

/**
 * Session tokens and the cookie that carries them.
 *
 * The token is an Auth.js v5 JWE (encrypted, not merely signed), so claims are
 * opaque to the browser. It carries identity only — `userId`, `companyId` and
 * `sessionVersion`. Permissions are deliberately NOT in the token: they are
 * resolved from the database per request so that revoking a role takes effect
 * on the next click rather than on the next login.
 *
 * `sessionVersion` is the revocation lever. Bumping `users.session_version`
 * (disable account, "log out everywhere", password reset) makes every
 * outstanding token fail its check without any server-side session store.
 *
 * Flow reference: docs/05-architecture.md §4.
 */

/** Sliding window. `security.session_hours` in system settings mirrors this. */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/** Reissue the cookie when this much of the window has already elapsed. */
const REFRESH_AFTER_SECONDS = 60 * 60;

/**
 * The `__Secure-` prefix tells the browser to reject the cookie if it ever
 * arrives over plain HTTP, which closes off downgrade attacks.
 */
export const SESSION_COOKIE_NAME = isProd ? "__Secure-hrms.session" : "hrms.session";

export interface SessionClaims {
  userId: string;
  companyId: string;
  sessionVersion: number;
  /** Seconds since epoch. */
  iat: number;
  /** Seconds since epoch. */
  exp: number;
}

type RawClaims = Record<string, unknown>;

export function sessionCookieOptions(maxAgeSeconds = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export async function createSessionToken(input: {
  userId: string;
  companyId: string;
  sessionVersion: number;
}): Promise<string> {
  return encode({
    token: {
      userId: input.userId,
      companyId: input.companyId,
      sessionVersion: input.sessionVersion,
    },
    secret: authSecret(),
    salt: SESSION_COOKIE_NAME,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/** Returns null for anything that is missing, tampered with, or expired. */
export async function readSessionToken(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  let claims: RawClaims | null;
  try {
    claims = (await decode({
      token,
      secret: authSecret(),
      salt: SESSION_COOKIE_NAME,
    })) as RawClaims | null;
  } catch {
    return null;
  }
  if (!claims) return null;

  const { userId, companyId, sessionVersion, iat, exp } = claims;
  if (
    typeof userId !== "string" ||
    typeof companyId !== "string" ||
    typeof sessionVersion !== "number" ||
    typeof iat !== "number" ||
    typeof exp !== "number"
  ) {
    return null;
  }
  return { userId, companyId, sessionVersion, iat, exp };
}

/** True once the token is old enough to be worth reissuing. */
export function shouldRefresh(claims: SessionClaims): boolean {
  const ageSeconds = Math.floor(Date.now() / 1000) - claims.iat;
  return ageSeconds > REFRESH_AFTER_SECONDS;
}

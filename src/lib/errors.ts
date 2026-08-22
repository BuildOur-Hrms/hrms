/**
 * Error taxonomy. Services throw these; `withApi` maps them to the canonical
 * response envelope. See docs/05-architecture.md §9 and docs/08-api.md.
 *
 * Anything that is NOT an AppError is an unexpected error: it is logged with a
 * full stack and returned to the caller as a bare 500 INTERNAL, never with
 * internals attached.
 */

export type ErrorDetails = Record<string, string[]>;

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: ErrorDetails;
  /** Extra context for logs only — never serialized to the client. */
  readonly context?: Record<string, unknown>;

  constructor(
    code: string,
    status: number,
    message: string,
    options?: { details?: ErrorDetails; context?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    if (options?.details) this.details = options.details;
    if (options?.context) this.context = options.context;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** 400 — malformed input that failed schema validation. */
export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: ErrorDetails) {
    super("VALIDATION_ERROR", 400, message, details ? { details } : undefined);
  }
}

/** 401 — no session, expired session, or stale session_version. */
export class AuthError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHENTICATED", 401, message);
  }
}

/** 403 — authenticated but lacking the declared permission. */
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super("FORBIDDEN", 403, message);
  }
}

/**
 * 404 — also the response for a row that exists in another tenant. Never
 * distinguish "not found" from "not yours": that difference leaks existence.
 */
export class NotFoundError extends AppError {
  constructor(entity = "Resource") {
    super("NOT_FOUND", 404, `${entity} not found`);
  }
}

/** 409 — uniqueness or concurrent-modification conflict. */
export class ConflictError extends AppError {
  constructor(message = "Conflicts with an existing record") {
    super("CONFLICT", 409, message);
  }
}

/**
 * 422 — input was well-formed but the domain refuses it (insufficient leave
 * balance, locked month, invalid state transition, approver == requester).
 */
export class BusinessRuleError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super("BUSINESS_RULE", 422, message, context ? { context } : undefined);
  }
}

/** 429 — rate limit tripped. */
export class RateLimitError extends AppError {
  constructor(retryAfterSeconds: number) {
    super("RATE_LIMITED", 429, "Too many requests. Please try again later.", {
      context: { retryAfterSeconds },
    });
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

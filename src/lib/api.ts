import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";

import { Prisma } from "@/generated/prisma/client";

import { authenticate, type RequestContext } from "./context";
import { withTenant } from "./db";
import { env } from "./env";
import {
  AppError,
  AuthError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  isAppError,
  type ErrorDetails,
} from "./errors";
import { childLogger } from "./logger";
import { requirePermission, type PermissionCode } from "./permissions";
import { enforceRateLimit, type RateLimitBucket } from "./rate-limit";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  readSessionToken,
  sessionCookieOptions,
  shouldRefresh,
} from "./session";

/**
 * The one pipeline every `/api/v1` route goes through, in this order
 * (docs/05-architecture.md §3):
 *
 *   1. request id + logger
 *   2. CSRF origin check on mutating methods
 *   3. rate limit
 *   4. authenticate — decode cookie, load user, verify session_version
 *   5. tenant resolve — open the transaction, set the RLS session variables
 *   6. requirePermission — the permission declared by the route
 *   7. zod validate — body and query
 *   8. service call
 *
 * Route handlers stay thin adapters. All domain logic lives in src/modules.
 */

// ─────────────────────────────────────────────── envelope

export interface ListMeta {
  page: number;
  pageSize: number;
  total: number;
}

const LIST_MARKER = Symbol("hrms.list");

interface ListResult<T> {
  [LIST_MARKER]: true;
  data: T[];
  meta: ListMeta;
}

/** Wrap a page of rows so `withApi` emits `{ data, meta }`. */
export function list<T>(data: T[], meta: ListMeta): ListResult<T> {
  return { [LIST_MARKER]: true, data, meta };
}

function isListResult(value: unknown): value is ListResult<unknown> {
  return typeof value === "object" && value !== null && LIST_MARKER in value;
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: ErrorDetails,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status, ...(headers ? { headers } : {}) },
  );
}

// ─────────────────────────────────────────────── request helpers

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function clientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
}

/** Caller metadata for services that run outside a `RequestContext` (auth). */
export function requestMeta(req: NextRequest) {
  return {
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    requestId: req.headers.get("x-request-id") ?? randomUUID(),
  };
}

/**
 * SameSite=Lax already blocks cross-site POSTs from forms, but it does nothing
 * about same-site subdomains or a browser that ignores it. An explicit
 * Origin/Referer check is the belt to that suspenders (docs/09-security.md §7).
 */
function assertSameOrigin(req: NextRequest): void {
  if (!MUTATING_METHODS.has(req.method)) return;

  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) {
    // Non-browser clients (curl, server-to-server) send neither header. They
    // also carry no ambient cookies, so there is nothing to forge.
    return;
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ForbiddenError("Invalid Origin header");
  }
  const expected = new URL(env.APP_URL).host;
  if (originHost !== expected && originHost !== req.nextUrl.host) {
    throw new ForbiddenError("Cross-origin request rejected");
  }
}

async function parseBody(req: NextRequest): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (req.method === "GET" || req.method === "DELETE") return {};
    throw new ValidationError("Expected content-type: application/json");
  }
  try {
    return await req.json();
  } catch {
    throw new ValidationError("Request body is not valid JSON");
  }
}

function queryToObject(req: NextRequest): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(req.nextUrl.searchParams.keys())) {
    const values = req.nextUrl.searchParams.getAll(key);
    out[key] = values.length > 1 ? values : values[0]!;
  }
  return out;
}

function zodDetails(error: { issues: { path: PropertyKey[]; message: string }[] }): ErrorDetails {
  const details: ErrorDetails = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_";
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

function validate<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`Invalid ${label}`, zodDetails(result.error));
  }
  return result.data;
}

// ─────────────────────────────────────────────── error mapping

/** Turn a driver-level failure into the same envelope a service would produce. */
function translateError(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002":
        return new ConflictError("A record with these values already exists");
      case "P2003":
        return new ConflictError("Referenced record does not exist or is still in use");
      case "P2025":
        return new NotFoundError();
      default:
        break;
    }
  }
  return new AppError("INTERNAL", 500, "Something went wrong");
}

// ─────────────────────────────────────────────── withApi

type Empty = Record<string, never>;

export interface ApiHandlerArgs<TBody, TQuery, TParams> {
  ctx: RequestContext;
  body: TBody;
  query: TQuery;
  params: TParams;
  req: NextRequest;
}

export interface ApiOptions<TBody, TQuery, TParams> {
  /** The permission this route requires. Omit only for session-only reads. */
  permission?: PermissionCode;
  /** Public route: no session, no tenant transaction. `ctx` is not provided. */
  public?: boolean;
  body?: ZodType<TBody>;
  query?: ZodType<TQuery>;
  params?: ZodType<TParams>;
  rateLimit?: RateLimitBucket;
  /** Success status for the happy path. Use 201 on creation. */
  status?: number;
}

/**
 * Next generates a route type per handler and requires the second argument to
 * be present and non-optional, even for routes with no dynamic segments (where
 * `params` simply resolves to `{}`).
 */
type RouteSegment = { params: Promise<Record<string, string | string[]>> };

export function withApi<TBody = Empty, TQuery = Empty, TParams = Record<string, string>>(
  options: ApiOptions<TBody, TQuery, TParams>,
  handler: (args: ApiHandlerArgs<TBody, TQuery, TParams>) => Promise<unknown>,
) {
  return async function route(req: NextRequest, segment: RouteSegment): Promise<NextResponse> {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    const ip = clientIp(req);
    const log = childLogger({ requestId, method: req.method, path: req.nextUrl.pathname });
    const started = Date.now();

    try {
      assertSameOrigin(req);

      const rawParams = ((await segment?.params) ?? {}) as Record<string, string | string[]>;
      const params = options.params
        ? validate(options.params, rawParams, "path parameters")
        : (rawParams as TParams);

      const body = options.body
        ? validate(options.body, await parseBody(req), "request body")
        : ({} as TBody);
      const query = options.query
        ? validate(options.query, queryToObject(req), "query parameters")
        : ({} as TQuery);

      // ── public routes stop short of tenancy: there is no tenant yet.
      if (options.public) {
        if (options.rateLimit) await enforceRateLimit(options.rateLimit, ip ?? "unknown");
        const result = await handler({
          ctx: undefined as unknown as RequestContext,
          body,
          query,
          params,
          req,
        });
        return respond(result, options.status ?? 200, requestId);
      }

      const claims = await readSessionToken(req.cookies.get(SESSION_COOKIE_NAME)?.value);
      if (!claims) throw new AuthError();

      if (options.rateLimit) await enforceRateLimit(options.rateLimit, claims.userId);

      const result = await withTenant(claims.companyId, async (db) => {
        const identity = await authenticate(db, claims);

        const ctx: RequestContext = {
          ...identity,
          requestId,
          ip,
          userAgent: req.headers.get("user-agent"),
          db,
          log: log.child({ userId: identity.userId, companyId: identity.companyId }),
        };

        if (options.permission) requirePermission(ctx, options.permission);

        return handler({ ctx, body, query, params, req });
      });

      const response = respond(result, options.status ?? 200, requestId);

      // Sliding expiry: touching the API keeps an active session alive.
      if (shouldRefresh(claims)) {
        const refreshed = await createSessionToken({
          userId: claims.userId,
          companyId: claims.companyId,
          sessionVersion: claims.sessionVersion,
        });
        response.cookies.set(SESSION_COOKIE_NAME, refreshed, sessionCookieOptions());
      }

      return response;
    } catch (error) {
      const appError = translateError(error);

      if (appError.status >= 500) {
        log.error({ err: error, requestId }, "unhandled error in route");
      } else {
        log.warn(
          { code: appError.code, status: appError.status, context: appError.context },
          appError.message,
        );
      }

      const headers: Record<string, string> = { "x-request-id": requestId };
      if (appError.code === "RATE_LIMITED") {
        const retryAfter = appError.context?.["retryAfterSeconds"];
        if (typeof retryAfter === "number") headers["Retry-After"] = String(retryAfter);
      }

      return errorResponse(
        appError.code,
        appError.message,
        appError.status,
        appError.details,
        headers,
      );
    } finally {
      log.debug({ ms: Date.now() - started }, "request complete");
    }
  };
}

function respond(result: unknown, status: number, requestId: string): NextResponse {
  const headers = { "x-request-id": requestId };

  if (result instanceof NextResponse) return result;
  if (result === undefined || result === null) {
    return NextResponse.json({ data: { ok: true } }, { status, headers });
  }
  if (isListResult(result)) {
    return NextResponse.json({ data: result.data, meta: result.meta }, { status, headers });
  }
  return NextResponse.json({ data: result }, { status, headers });
}

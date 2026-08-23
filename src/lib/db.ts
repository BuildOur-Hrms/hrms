import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

import { env, isProd, isServerless } from "./env";

/**
 * Database access. Two independent isolation layers guard tenancy
 * (docs/04-database.md §4):
 *
 *   Layer 1 (this file) — a Prisma client extension injects `company_id` into
 *   every model operation, so business code physically cannot forget it.
 *
 *   Layer 2 (migration `rls`) — Postgres row-level security re-checks the same
 *   thing against `app.company_id`, a session variable set per transaction. If
 *   layer 1 is ever bypassed, RLS returns zero rows instead of another
 *   tenant's data.
 *
 * Everything a request touches must go through `withTenant()`. The unscoped
 * `adminDb` exists only for pre-authentication lookups (login by email, reset
 * tokens) and platform/super-admin code paths, and every one of those is
 * expected to be narrow and audited.
 */

/**
 * Pool sizing.
 *
 * On a serverless host every warm function instance holds its own pool, and
 * there may be dozens of instances. A generous per-instance pool multiplied by
 * the instance count is how a Supabase project runs out of connections. Keep
 * it small and let the platform's pooler do the multiplexing; release idle
 * connections quickly, since an instance may sit warm and unused for minutes.
 */
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: isServerless ? 3 : isProd ? 10 : 5,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: isServerless ? 10_000 : 30_000,
});

const globalForPrisma = globalThis as unknown as { prismaBase?: PrismaClient };

/**
 * Raw, unscoped client. Not exported — reach it through `adminDb` (which makes
 * the escape explicit) or `withTenant` (which scopes it).
 */
const prismaBase =
  globalForPrisma.prismaBase ??
  new PrismaClient({
    adapter,
    log: isProd ? ["warn", "error"] : ["warn", "error"],
  });

if (!isProd) globalForPrisma.prismaBase = prismaBase;

/**
 * Unscoped client. Using this is a deliberate decision that bypasses layer 1;
 * it is still subject to RLS unless wrapped in `withPlatform()`.
 *
 * Legitimate uses: login (no tenant context exists before authentication),
 * password-reset token lookup, health checks, platform/super-admin services.
 */
export const adminDb = prismaBase;

// ─────────────────────────────────────────────── tenant scoping

/**
 * Models carrying a `company_id` column, i.e. everything the extension scopes.
 *
 * Deliberately absent:
 *  - `Company`          — scoped by its own `id`, handled separately below.
 *  - `Permission`       — a global, platform-owned catalog.
 *  - `RolePermission` / `UserRole` / `PasswordResetToken` — no `company_id`;
 *    they inherit tenancy through their parent row and are guarded by RLS
 *    policies that join to that parent.
 */
const TENANT_MODELS = new Set([
  "Location",
  "Department",
  "Designation",
  "Shift",
  "EmployeeShift",
  "AttendancePunch",
  "AttendanceRecord",
  "AttendanceCorrection",
  "AttendanceMonthLock",
  "Holiday",
  "LeaveType",
  "LeavePolicy",
  "LeaveBalance",
  "LeaveRequest",
  "User",
  "Role",
  "Employee",
  "EmergencyContact",
  "AuditLog",
]);

/** Reads may also see platform-global rows (`company_id IS NULL`); writes may not. */
const GLOBAL_READABLE_MODELS = new Set(["SystemSetting"]);

/** Models with a `deleted_at` column, filtered out of reads by default. */
const SOFT_DELETE_MODELS = new Set([
  "Company",
  "Location",
  "Department",
  "Designation",
  "Shift",
  "LeaveType",
  "Employee",
  "EmergencyContact",
]);

const READ_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "aggregate",
  "count",
  "groupBy",
]);

const WHERE_OPERATIONS = new Set([
  ...READ_OPERATIONS,
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

const CREATE_OPERATIONS = new Set(["create", "createMany", "createManyAndReturn", "upsert"]);

type AnyArgs = Record<string, unknown>;

function mergeWhere(args: AnyArgs, scope: AnyArgs): void {
  const existing = (args["where"] ?? {}) as AnyArgs;
  args["where"] = { ...existing, ...scope };
}

function applyCreateScope(args: AnyArgs, companyId: string, operation: string): void {
  const stamp = (row: unknown) => {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      (row as AnyArgs)["companyId"] = companyId;
    }
  };

  if (operation === "upsert") {
    stamp(args["create"]);
    return;
  }
  const data = args["data"];
  if (Array.isArray(data)) data.forEach(stamp);
  else stamp(data);
}

/**
 * `deleted_at IS NULL` unless the caller opted in. Callers that genuinely need
 * archived rows (restore flows, audit views) pass `where.deletedAt` themselves,
 * which we then leave alone.
 */
function applySoftDeleteFilter(args: AnyArgs): void {
  const where = (args["where"] ?? {}) as AnyArgs;
  if ("deletedAt" in where) return;
  args["where"] = { ...where, deletedAt: null };
}

function tenantExtension(companyId: string) {
  return {
    name: "tenant-scope",
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          const a = (args ?? {}) as AnyArgs;

          if (model === "Company") {
            if (WHERE_OPERATIONS.has(operation)) mergeWhere(a, { id: companyId });
          } else if (GLOBAL_READABLE_MODELS.has(model)) {
            if (READ_OPERATIONS.has(operation)) {
              const existing = (a["where"] ?? {}) as AnyArgs;
              a["where"] = {
                ...existing,
                OR: [{ companyId }, { companyId: null }],
              };
            } else if (WHERE_OPERATIONS.has(operation)) {
              mergeWhere(a, { companyId });
            }
            if (CREATE_OPERATIONS.has(operation)) applyCreateScope(a, companyId, operation);
          } else if (TENANT_MODELS.has(model)) {
            if (WHERE_OPERATIONS.has(operation)) mergeWhere(a, { companyId });
            if (CREATE_OPERATIONS.has(operation)) applyCreateScope(a, companyId, operation);
          }

          if (SOFT_DELETE_MODELS.has(model) && READ_OPERATIONS.has(operation)) {
            applySoftDeleteFilter(a);
          }

          return query(a);
        },
      },
    },
  };
}

/** A Prisma client that has tenant scoping baked in. */
export type TenantDb = ReturnType<typeof buildTenantClient>;

function buildTenantClient(companyId: string) {
  return prismaBase.$extends(tenantExtension(companyId));
}

/** The transaction-bound handle handed to callers of `withTenant`. */
export type TenantTx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Run `fn` inside one transaction with the RLS session variables set.
 *
 * `set_config(..., true)` is transaction-local, so the setting is discarded on
 * commit or rollback — a pooled connection can never be handed to the next
 * request still carrying the previous tenant's id.
 */
export async function withTenant<T>(
  companyId: string,
  fn: (tx: TenantTx) => Promise<T>,
  options?: { superAdmin?: boolean; timeoutMs?: number },
): Promise<T> {
  const db = buildTenantClient(companyId);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.company_id', ${quoteLiteral(companyId)}, true),` +
          ` set_config('app.is_super_admin', ${quoteLiteral(options?.superAdmin ? "on" : "off")}, true)`,
      );
      return fn(tx);
    },
    { timeout: options?.timeoutMs ?? 15_000 },
  );
}

/**
 * Escape hatch for code that legitimately has no tenant context: login,
 * password-reset tokens, seeding, and platform administration.
 *
 * Sets `app.bypass_rls`, which every RLS policy honours, so the callback sees
 * the whole database. Keep these callbacks as small as possible — a query in
 * here has neither isolation layer protecting it.
 */
export async function withPlatform<T>(
  fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  return prismaBase.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_rls', 'on', true)`);
      return fn(tx);
    },
    { timeout: options?.timeoutMs ?? 30_000 },
  );
}

/** Readiness probe for `/api/health`. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await prismaBase.$queryRawUnsafe("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

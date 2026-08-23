import { Client } from "pg";

import { NextRequest } from "next/server";

import { bootstrap } from "@/lib/bootstrap";
import { withPlatform } from "@/lib/db";
import {
  PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  type SystemRole,
} from "@/lib/permissions";
import { SESSION_COOKIE_NAME, createSessionToken } from "@/lib/session";

/**
 * Two companies, four roles each, against a real Postgres with RLS active.
 *
 * The suite calls route handlers rather than services, so every assertion goes
 * through the whole pipeline — CSRF check, session, tenant transaction,
 * permission, zod — exactly as a browser would. A test that called the service
 * directly would prove the service correct and the endpoint untested, which is
 * the half that faces the internet.
 *
 * Two tenants rather than one because the interesting failure is never "can I
 * read my own data". It is "can I read theirs".
 */

const APP_URL = "http://localhost:3000";

export interface Persona {
  role: SystemRole;
  userId: string;
  employeeId: string;
  email: string;
  cookie: string;
}

export interface Tenant {
  companyId: string;
  slug: string;
  departmentId: string;
  designationId: string;
  locationId: string;
  shiftId: string;
  leaveTypeId: string;
  superAdmin: Persona;
  hr: Persona;
  manager: Persona;
  employee: Persona;
}

/**
 * Whether this connection is actually subject to row-level security.
 *
 * A superuser, or any role with BYPASSRLS, skips every policy — FORCE ROW
 * LEVEL SECURITY subjects the table *owner*, not a superuser. Run the suite as
 * one and the isolation tests still pass, because the application layer alone
 * happens to be correct while the layer that exists for the day it is not has
 * been switched off.
 *
 * PGlite, the zero-install local database, always connects as `postgres` and
 * ignores the role in the connection string, so it can never satisfy this. CI
 * runs real Postgres with `npm run db:role`, and that is where the second
 * layer is actually proven.
 */
export async function rlsEnforced(): Promise<boolean> {
  const [role] = await withPlatform((db) =>
    db.$queryRawUnsafe<{ who: string; rolsuper: boolean; rolbypassrls: boolean }[]>(
      "SELECT current_user AS who, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    ),
  );
  if (!role) throw new Error("Could not identify the database role");
  return !role.rolsuper && !role.rolbypassrls;
}

/**
 * Strict by default: a run that cannot enforce RLS has to say so out loud.
 *
 * `HRMS_ALLOW_RLS_BYPASS=1` narrows the claim rather than widening it — the
 * database-layer tests skip, the application-layer ones still run, and nobody
 * can mistake a green local run for a proof of isolation.
 */
async function assertSuiteIsMeaningful(): Promise<void> {
  if (await rlsEnforced()) return;
  if (process.env["HRMS_ALLOW_RLS_BYPASS"] === "1") return;

  throw new Error(
    "This connection bypasses row-level security, so the isolation suite would prove nothing. " +
      "Point DATABASE_URL at the role `npm run db:role` creates, or set HRMS_ALLOW_RLS_BYPASS=1 " +
      "to run only the application-layer half (PGlite cannot enforce RLS).",
  );
}

/** Every table the fixtures touch, children first. */
const TABLES = [
  "notifications",
  "announcement_reads",
  "announcements",
  "audit_logs",
  "leave_requests",
  "leave_balances",
  "leave_policies",
  "leave_types",
  "holidays",
  "attendance_month_locks",
  "attendance_corrections",
  "attendance_records",
  "attendance_punches",
  "employee_shifts",
  "shifts",
  "password_reset_tokens",
  "user_roles",
  "role_permissions",
  "roles",
  "emergency_contacts",
  "employees",
  "users",
  "system_settings",
  "designations",
  "departments",
  "locations",
  "companies",
  "permissions",
];

/**
 * Empty the database, on the owner connection.
 *
 * Not on the application connection, and not with `DELETE`: the app role has
 * data rights and no ownership, which is exactly what makes it worth testing
 * against — and the audit trigger refuses `DELETE` on principle, which is
 * exactly what makes it worth having. `TRUNCATE` as the owner fires no row
 * triggers and needs no cascade ordering.
 *
 * Fixtures are built as the owner; the tests themselves run as the app role.
 */
export async function resetDatabase(): Promise<void> {
  const url = process.env["DIRECT_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  if (!url) throw new Error("Set DIRECT_DATABASE_URL to the owner connection");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  } finally {
    await client.end();
  }
}

async function persona(
  companyId: string,
  role: SystemRole,
  roleIds: Record<SystemRole, string>,
  slug: string,
  org: { departmentId: string; designationId: string; locationId: string },
  managerId: string | null,
): Promise<Persona> {
  const email = `${role}@${slug}.test`;

  const { userId, employeeId } = await withPlatform(async (db) => {
    const user = await db.user.create({
      data: { companyId, email, status: "active", passwordHash: "x" },
      select: { id: true },
    });
    const employee = await db.employee.create({
      data: {
        companyId,
        userId: user.id,
        employeeCode: `${slug.toUpperCase()}-${role}`,
        firstName: role,
        lastName: slug,
        departmentId: org.departmentId,
        designationId: org.designationId,
        locationId: org.locationId,
        managerId,
        employmentType: "full_time",
        status: "active",
        joinDate: new Date("2024-01-01T00:00:00.000Z"),
      },
      select: { id: true },
    });
    await db.userRole.create({ data: { userId: user.id, roleId: roleIds[role] } });
    return { userId: user.id, employeeId: employee.id };
  });

  const token = await createSessionToken({ userId, companyId, sessionVersion: 1 });
  return { role, userId, employeeId, email, cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedTenant(slug: string): Promise<Tenant> {
  const company = await withPlatform((db) =>
    db.company.create({
      data: {
        name: slug,
        slug,
        timezone: "Asia/Kolkata",
        currency: "INR",
        status: "active",
      },
      select: { id: true },
    }),
  );
  const companyId = company.id;

  const org = await withPlatform(async (db) => {
    const location = await db.location.create({
      data: { companyId, name: "Head office", code: "HO" },
      select: { id: true },
    });
    const department = await db.department.create({
      data: { companyId, name: "Engineering", code: "ENG" },
      select: { id: true },
    });
    const designation = await db.designation.create({
      data: { companyId, title: "Engineer", code: "ENGR", level: 3 },
      select: { id: true },
    });
    const shift = await db.shift.create({
      data: {
        companyId,
        name: "General",
        code: "GEN",
        startTime: new Date("1970-01-01T09:00:00.000Z"),
        endTime: new Date("1970-01-01T18:00:00.000Z"),
        halfDayThresholdMinutes: 240,
        isDefault: true,
      },
      select: { id: true },
    });
    const leaveType = await db.leaveType.create({
      data: { companyId, name: "Casual", code: "CL", isPaid: true },
      select: { id: true },
    });
    return {
      locationId: location.id,
      departmentId: department.id,
      designationId: designation.id,
      shiftId: shift.id,
      leaveTypeId: leaveType.id,
    };
  });

  // Roles and their grants, straight from the role matrix — the same source
  // the seed and the permission-matrix suite read.
  const roleIds = await withPlatform(async (db) => {
    const ids = {} as Record<SystemRole, string>;
    const permissions = await db.permission.findMany({ select: { id: true, code: true } });
    const idOf = new Map(permissions.map((p) => [p.code, p.id]));

    for (const name of SYSTEM_ROLES) {
      const role = await db.role.create({
        data: { companyId, name, description: ROLE_DESCRIPTIONS[name], isSystem: true },
        select: { id: true },
      });
      ids[name] = role.id;
      await db.rolePermission.createMany({
        data: ROLE_PERMISSIONS[name].map((code) => ({
          roleId: role.id,
          permissionId: idOf.get(code)!,
        })),
      });
    }
    return ids;
  });

  const manager = await persona(companyId, "manager", roleIds, slug, org, null);
  const [superAdmin, hr, employee] = await Promise.all([
    persona(companyId, "super_admin", roleIds, slug, org, null),
    persona(companyId, "hr_admin", roleIds, slug, org, null),
    persona(companyId, "employee", roleIds, slug, org, manager.employeeId),
  ]);

  return { companyId, slug, ...org, superAdmin, hr, manager, employee };
}

export interface Tenants {
  acme: Tenant;
  globex: Tenant;
}

/**
 * Build the whole world once.
 *
 * The permission catalog is global rather than per tenant, so it is written
 * before either company exists — as the seed does.
 */
export async function seedTenants(): Promise<Tenants> {
  bootstrap();
  await assertSuiteIsMeaningful();
  await resetDatabase();

  await withPlatform((db) =>
    db.permission.createMany({
      data: PERMISSIONS.map((p) => ({ code: p.code, module: p.module, action: p.action })),
      skipDuplicates: true,
    }),
  );

  // Sequential: PGlite serialises queries, and a parallel seed only makes the
  // failure harder to read.
  const acme = await seedTenant("acme");
  const globex = await seedTenant("globex");
  return { acme, globex };
}

// ─────────────────────────────────────────────── calling routes

type Handler = (
  req: NextRequest,
  segment: { params: Promise<Record<string, string | string[]>> },
) => Promise<Response>;

export interface CallOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  params?: Record<string, string | string[]>;
  /** Omit to call anonymously. */
  as?: Persona;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
}

export interface CallResult<T = unknown> {
  status: number;
  data: T;
  error: { code: string; message: string } | null;
}

/**
 * Invoke a route handler the way Next would, and hand back the raw response.
 *
 * For the endpoints that do not answer in JSON — a CSV download, a file. `call`
 * is the one to reach for otherwise.
 */
export async function callRaw(
  handler: Handler,
  path: string,
  options: CallOptions = {},
): Promise<Response> {
  const url = new URL(path, APP_URL);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const method = options.method ?? (options.body !== undefined ? "POST" : "GET");
  const headers = new Headers();
  if (options.as) headers.set("cookie", options.as.cookie);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  // The pipeline rejects a cross-origin mutation; a browser would send this.
  headers.set("origin", APP_URL);

  // A `NextRequest`, not a `Request`: the pipeline reads `nextUrl`, which only
  // the former has.
  const request = new NextRequest(url, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  return handler(request, { params: Promise.resolve(options.params ?? {}) });
}

/** Invoke a route handler and unwrap the `{ data, error }` envelope. */
export async function call<T = unknown>(
  handler: Handler,
  path: string,
  options: CallOptions = {},
): Promise<CallResult<T>> {
  const response = await callRaw(handler, path, options);
  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { code: string; message: string };
  } | null;

  return {
    status: response.status,
    data: (payload?.data ?? null) as T,
    error: payload?.error ?? null,
  };
}

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import {
  ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  isPermissionCode,
  type PermissionCode,
  type SystemRole,
} from "../src/lib/permissions";

/**
 * The permission matrix, generated from the routes rather than written down.
 *
 * docs/00-overview-and-roles.md §6.4 is the canonical role matrix and
 * `src/lib/permissions.ts` materialises it. This walks every route file, reads
 * the permission each one declares, and crosses the two — so the answer to
 * "can a manager call this endpoint" is derived from the code that enforces
 * it, not from someone's memory of what it should be.
 *
 *   npx tsx scripts/permission-matrix.ts        # rewrite docs/permission-matrix.md
 *
 * The committed file is checked in CI. A route that changes who can reach it
 * shows up as a diff in that table, which is exactly the kind of change that
 * should never pass review unnoticed.
 */

const API_ROOT = join(process.cwd(), "src", "app", "api");
const OUTPUT = join(process.cwd(), "docs", "permission-matrix.md");

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Method = (typeof METHODS)[number];

export type RouteKind =
  /** Requires the named permission. */
  | "permission"
  /** No session at all — login, password reset. */
  | "public"
  /** Signed in, no further permission. */
  | "session"
  /** Called by the scheduler with a shared secret; no user involved. */
  | "cron";

export interface RouteDeclaration {
  path: string;
  method: Method;
  kind: RouteKind;
  permission: PermissionCode | null;
  file: string;
}

/**
 * Routes that deliberately require only a session.
 *
 * Every entry is a decision, and the reason is the point of the list: a route
 * that reaches this file without being here fails the suite, so "I forgot to
 * add a permission" cannot look like "this one is meant to be open".
 */
export const SESSION_ONLY_REASONS: Record<string, string> = {
  "GET /api/v1/auth/me": "Your own identity, and nothing else.",
  "POST /api/v1/auth/logout": "Ending your own session needs no permission.",
  "POST /api/v1/auth/change-password":
    "Changing your own password. The only account it can touch is the one making the request, and the current password stands in for the proof of identity a reset link would carry.",
  "GET /api/v1/me/profile": "Your own profile.",
  "PATCH /api/v1/me/profile": "Your own profile, through a field allowlist.",
  "POST /api/v1/me/profile/complete":
    "Finishing your own setup after an invite, through the same allowlist.",

  "GET /api/v1/files/:...key":
    "The local storage driver standing in for a bucket. Keys begin with the company id and are checked against the caller's before anything is read; a presigned URL would carry its own authority, and this one carries a session instead.",
  "PUT /api/v1/files/:...key":
    "The other half of the same stand-in. Same company check, same reason.",

  "GET /api/v1/notifications": "Your own notifications.",
  "POST /api/v1/notifications/read": "Marking your own notifications read.",
  "GET /api/v1/announcements": "Announcements addressed to you; drafts filtered in the service.",
  "POST /api/v1/announcements":
    "assertCanAnnounce in the service, which also decides the audience.",
  "POST /api/v1/announcements/:id/publish": "Same check as writing one.",
  "DELETE /api/v1/announcements/:id": "Same check as writing one.",
  "POST /api/v1/announcements/:id/read": "Marking one you can already see as read.",

  "GET /api/v1/companies/current": "Name, timezone and currency. The app shell needs them.",
  "GET /api/v1/departments": "Names appear in every employee form and filter.",
  "GET /api/v1/designations": "Names appear in every employee form and filter.",
  "GET /api/v1/locations": "Names appear in every employee form and filter.",
  "GET /api/v1/org/options": "The department, designation and location pickers.",
  "GET /api/v1/leave-types": "The apply form needs the list.",
  "GET /api/v1/holidays": "The calendar is company-public by nature.",
  "GET /api/v1/shifts": "Shift names appear on every attendance screen.",
  "GET /api/v1/shifts/:id": "Shift names appear on every attendance screen.",

  "GET /api/v1/employees": "Own, team or company scope, decided in the service.",
  "GET /api/v1/employees/:id": "Object-level scope in the service; a foreign id is a 404.",
  "GET /api/v1/employees/:id/emergency-contacts": "Your own record, or one you may already view.",
  "POST /api/v1/employees/:id/emergency-contacts": "Your own record, or one you may already edit.",
  "PATCH /api/v1/employees/:id/emergency-contacts/:contactId": "As above.",
  "DELETE /api/v1/employees/:id/emergency-contacts/:contactId": "As above.",
  "GET /api/v1/employees/:id/shifts": "Scope decided per employee in the service.",

  "GET /api/v1/attendance/day": "Scope decided per employee in the service.",
  "GET /api/v1/attendance/month": "Scope decided per employee in the service.",
  "GET /api/v1/attendance/overview": "Team or company scope is checked in the service.",
  "GET /api/v1/attendance/corrections": "Scope decided in the service.",

  "GET /api/v1/leave/requests": "Scope decided in the service.",
  "DELETE /api/v1/leave/requests/:id": "Cancelling your own request.",
  "GET /api/v1/leave/balances": "Scope decided per employee in the service.",
  "GET /api/v1/leave/quote": "Prices your own request in days before you submit it.",

  "GET /api/v1/tasks": "Own, team or company scope, decided in the service.",
  "PATCH /api/v1/tasks/:id":
    "Progress is the worker's; the target's shape is not. Split in the service.",
  "DELETE /api/v1/tasks/:id":
    "You may withdraw what you added; removing an assignment is not yours.",
  "GET /api/v1/tasks/board": "The scope decides the permission; checked in the service.",
  "GET /api/v1/tasks/trend": "Scope decided per employee in the service.",

  "GET /api/v1/recruitment/jobs": "Refused to anybody not running hiring, in the service.",
  "GET /api/v1/recruitment/jobs/:id": "Refused to anybody not running hiring, in the service.",
  "GET /api/v1/recruitment/candidates": "Refused to anybody not running hiring, in the service.",
  "GET /api/v1/recruitment/applications": "Refused to anybody not running hiring, in the service.",
  "GET /api/v1/recruitment/applications/:id":
    "Refused to anybody not running hiring, in the service.",
  "GET /api/v1/recruitment/offers": "Refused to anybody not running hiring, in the service.",
  "GET /api/v1/recruitment/interviews":
    "Your own rounds need no permission; scope=all is checked in the service.",
  "POST /api/v1/recruitment/interviews/:id/feedback":
    "The interviewer writes it. A declared permission would lock out the one person who must.",
  "POST /api/v1/recruitment/offers/:id/status":
    "Sending needs recruitment.approve; recording a reply does not. Split in the service.",
  "POST /api/v1/recruitment/offers/:id/convert":
    "Needs employee.create as well as pipeline edit; both checked in the service.",

  "GET /api/v1/reports": "The catalog, already filtered to what the caller may run.",
  "GET /api/v1/reports/:slug": "The scope decides the permission; checked in the service.",
};

/**
 * Handlers that run outside `withApi` and are meant to be unauthenticated.
 *
 * Anything else without the pipeline is a mistake, not a decision, so the
 * suite refuses it rather than printing it as public.
 */
export const UNAUTHENTICATED: Record<string, string> = {
  "GET /api/health": "Liveness and readiness, watched by uptime monitoring.",
};

// ─────────────────────────────────────────────── scanning

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...routeFiles(full));
    else if (entry.name === "route.ts") found.push(full);
  }
  return found.sort();
}

/** `src/app/api/v1/employees/[id]/route.ts` → `/api/v1/employees/:id`. */
function urlPath(file: string): string {
  const segments = relative(join(process.cwd(), "src", "app"), file)
    .split(sep)
    .slice(0, -1)
    .filter((segment) => !segment.startsWith("("))
    .map((segment) => (segment.startsWith("[") ? `:${segment.slice(1, -1)}` : segment));
  return `/${segments.join("/")}`;
}

/**
 * The object literal starting at `from`, as source text.
 *
 * Brace counting rather than a parser: the options object holds strings,
 * booleans and schema identifiers, and a route file that needed more
 * structure than that would be doing too much in the adapter layer.
 */
function objectLiteralAt(source: string, from: number): string | null {
  const start = source.indexOf("{", from);
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

export function declarationsIn(file: string, source: string): RouteDeclaration[] {
  const path = urlPath(file);
  const isCron = source.includes("cronAuthorized");
  const found: RouteDeclaration[] = [];

  for (const method of METHODS) {
    const withApi = new RegExp(`export const ${method}\\s*=\\s*withApi`).exec(source);
    if (withApi) {
      const options = objectLiteralAt(source, withApi.index + withApi[0].length) ?? "";
      const permission = /permission:\s*"([^"]+)"/.exec(options)?.[1] ?? null;
      const isPublic = /public:\s*true/.test(options);

      if (permission && !isPermissionCode(permission)) {
        throw new Error(`${file}: ${method} declares unknown permission "${permission}"`);
      }

      found.push({
        path,
        method,
        kind: permission ? "permission" : isPublic ? "public" : "session",
        permission: permission as PermissionCode | null,
        file,
      });
      continue;
    }

    // Cron endpoints are plain handlers: there is no session, no tenant and no
    // user to check a permission against, only the shared secret.
    if (new RegExp(`export async function ${method}\\b`).test(source)) {
      found.push({ path, method, kind: isCron ? "cron" : "public", permission: null, file });
    }
  }

  return found;
}

export function scanRoutes(): RouteDeclaration[] {
  return routeFiles(API_ROOT)
    .flatMap((file) => declarationsIn(file, readFileSync(file, "utf8")))
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

// ─────────────────────────────────────────────── the grid

export function endpointKey(route: RouteDeclaration): string {
  return `${route.method} ${route.path}`;
}

/** Whether a role may reach a route, derived from the role matrix. */
export function allows(route: RouteDeclaration, role: SystemRole): boolean {
  switch (route.kind) {
    case "public":
      return true;
    case "cron":
      return false;
    case "session":
      return true;
    case "permission":
      return ROLE_PERMISSIONS[role].includes(route.permission!);
  }
}

export function renderMatrix(routes: RouteDeclaration[]): string {
  const header = `# Permission matrix

> Generated by \`npx tsx scripts/permission-matrix.ts\`. Do not edit by hand.
>
> Every \`/api/v1\` endpoint crossed with the four system roles, derived from
> the permission each route declares and the role matrix in
> \`docs/00-overview-and-roles.md\` §6.4. A change to who can reach an endpoint
> shows up here as a diff.
>
> \`✓\` reachable · \`·\` 403 · \`—\` not applicable (public, or scheduler-only).

| Endpoint | Requires | ${SYSTEM_ROLES.join(" | ")} |
|---|---|${SYSTEM_ROLES.map(() => "---").join("|")}|
`;

  const rows = routes.map((route) => {
    const requires =
      route.kind === "permission"
        ? `\`${route.permission}\``
        : route.kind === "public"
          ? "_public_"
          : route.kind === "cron"
            ? "_scheduler_"
            : "_session_";

    const cells = SYSTEM_ROLES.map((role) => {
      if (route.kind === "public" || route.kind === "cron") return "—";
      return allows(route, role) ? "✓" : "·";
    });

    return `| \`${endpointKey(route)}\` | ${requires} | ${cells.join(" | ")} |`;
  });

  const counts = SYSTEM_ROLES.map(
    (role) => `${role}: ${routes.filter((r) => r.kind === "permission" && allows(r, role)).length}`,
  ).join(" · ");

  return `${header}${rows.join("\n")}

**${routes.length} endpoints.** Permission-gated endpoints reachable per role — ${counts}.
`;
}

// ─────────────────────────────────────────────── cli

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/permission-matrix.ts");
if (isMain) {
  const routes = scanRoutes();
  writeFileSync(OUTPUT, renderMatrix(routes), "utf8");
  console.log(`Wrote ${relative(process.cwd(), OUTPUT)} — ${routes.length} endpoints.`);
}

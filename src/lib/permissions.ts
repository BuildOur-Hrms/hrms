import { ForbiddenError } from "./errors";

/**
 * Permission catalog and the default role → permission matrix.
 *
 * Canonical source: docs/00-overview-and-roles.md §6. This file materialises
 * that table exactly once; the seed writes it to the database and the
 * permission-matrix test suite reads it back, so a drift between the docs and
 * the running system fails CI rather than shipping.
 *
 * Two rules that hold everywhere:
 *   1. `manage` means "configure this module" and implies nothing else. Grants
 *      are always explicit.
 *   2. Feature code never branches on a role name. Always `can(ctx, "x.y")`.
 */

export const ACTIONS = [
  "view_own",
  "view_team",
  "view_all",
  "create",
  "edit",
  "delete",
  "approve",
  "export",
  "manage",
] as const;

export type Action = (typeof ACTIONS)[number];

/** module → the actions that exist for it. */
const CATALOG = {
  employee: ["view_own", "view_team", "view_all", "create", "edit", "delete", "export"],
  company: ["manage"],
  department: ["manage"],
  designation: ["manage"],
  settings: ["manage"],
  users: ["view_all", "manage"],
  roles: ["view_all", "manage"],
  shifts: ["manage"],
  attendance: [
    "view_own",
    "view_team",
    "view_all",
    "create",
    "edit",
    "approve",
    "export",
    "manage",
  ],
  leave: ["view_own", "view_team", "view_all", "create", "edit", "approve", "export", "manage"],
  holidays: ["manage"],
  payroll: ["view_own", "view_all", "create", "edit", "approve", "export", "manage"],
  documents: ["view_own", "view_team", "view_all", "create", "edit", "delete", "export", "manage"],
  recruitment: ["view_team", "view_all", "create", "edit", "delete", "approve", "export", "manage"],
  onboarding: ["view_own", "view_team", "view_all", "create", "edit", "manage"],
  offboarding: ["view_own", "view_team", "view_all", "create", "edit", "approve", "manage"],
  performance: [
    "view_own",
    "view_team",
    "view_all",
    "create",
    "edit",
    "approve",
    "export",
    "manage",
  ],
  training: ["view_own", "view_team", "view_all", "create", "edit", "delete", "export", "manage"],
  expenses: ["view_own", "view_team", "view_all", "create", "edit", "approve", "export", "manage"],
  notifications: ["view_own", "edit", "manage"],
  announcements: ["create"],
  reports: ["view_team", "view_all", "export", "manage"],
  audit: ["view_all", "export"],
  dashboard: ["view_team", "view_all"],
} as const satisfies Record<string, readonly Action[]>;

export type Module = keyof typeof CATALOG;

type CodeOf<M extends Module> = `${M}.${(typeof CATALOG)[M][number]}`;
export type PermissionCode = { [M in Module]: CodeOf<M> }[Module];

export interface PermissionDefinition {
  code: PermissionCode;
  module: Module;
  action: Action;
}

export const PERMISSIONS: readonly PermissionDefinition[] = Object.entries(CATALOG).flatMap(
  ([module, actions]) =>
    (actions as readonly Action[]).map((action) => ({
      code: `${module}.${action}` as PermissionCode,
      module: module as Module,
      action,
    })),
);

export const PERMISSION_CODES: readonly PermissionCode[] = PERMISSIONS.map((p) => p.code);

// ─────────────────────────────────────────────── system roles

export const SYSTEM_ROLES = ["super_admin", "hr_admin", "manager", "employee"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const ROLE_DESCRIPTIONS: Record<SystemRole, string> = {
  super_admin: "Platform owner. Every permission, across companies. Not part of approval chains.",
  hr_admin: "Full HR administration inside one company, including approval override.",
  manager: "Direct reports only: team work data and approvals. Never salary or bank details.",
  employee: "Self-service only: own profile, attendance, leave, documents and requests.",
};

/** Every role is also a person who uses the product. */
const SELF_SERVICE: readonly PermissionCode[] = [
  "employee.view_own",
  "attendance.view_own",
  "attendance.create",
  "leave.view_own",
  "leave.create",
  "leave.edit",
  "payroll.view_own",
  "documents.view_own",
  "documents.create",
  "onboarding.view_own",
  "offboarding.view_own",
  "offboarding.create",
  "performance.view_own",
  "performance.create",
  "training.view_own",
  "expenses.view_own",
  "expenses.create",
  "expenses.edit",
  "notifications.view_own",
  "notifications.edit",
];

const MANAGER_ONLY: readonly PermissionCode[] = [
  "employee.view_team",
  "attendance.view_team",
  "attendance.approve",
  "leave.view_team",
  "leave.approve",
  "documents.view_team",
  "recruitment.view_team",
  "recruitment.create",
  "onboarding.view_team",
  "offboarding.view_team",
  "offboarding.approve",
  "performance.view_team",
  "performance.approve",
  "training.view_team",
  "expenses.view_team",
  "expenses.approve",
  "reports.view_team",
  "reports.export",
  "dashboard.view_team",
];

const HR_ADMIN_ONLY: readonly PermissionCode[] = [
  "employee.view_team",
  "employee.view_all",
  "employee.create",
  "employee.edit",
  "employee.delete",
  "employee.export",
  "company.manage",
  "department.manage",
  "designation.manage",
  "settings.manage",
  "users.view_all",
  "users.manage",
  "roles.view_all",
  "roles.manage",
  "shifts.manage",
  "attendance.view_team",
  "attendance.view_all",
  "attendance.edit",
  "attendance.approve",
  "attendance.export",
  "attendance.manage",
  "leave.view_team",
  "leave.view_all",
  "leave.approve",
  "leave.export",
  "leave.manage",
  "holidays.manage",
  "payroll.view_all",
  "payroll.create",
  "payroll.edit",
  "payroll.approve",
  "payroll.export",
  "payroll.manage",
  "documents.view_team",
  "documents.view_all",
  "documents.edit",
  "documents.delete",
  "documents.export",
  "documents.manage",
  "recruitment.view_team",
  "recruitment.view_all",
  "recruitment.create",
  "recruitment.edit",
  "recruitment.delete",
  "recruitment.approve",
  "recruitment.export",
  "recruitment.manage",
  "onboarding.view_team",
  "onboarding.view_all",
  "onboarding.create",
  "onboarding.edit",
  "onboarding.manage",
  "offboarding.view_team",
  "offboarding.view_all",
  "offboarding.edit",
  "offboarding.approve",
  "offboarding.manage",
  "performance.view_team",
  "performance.view_all",
  "performance.edit",
  "performance.approve",
  "performance.export",
  "performance.manage",
  "training.view_team",
  "training.view_all",
  "training.create",
  "training.edit",
  "training.delete",
  "training.export",
  "training.manage",
  "expenses.view_team",
  "expenses.view_all",
  "expenses.approve",
  "expenses.export",
  "expenses.manage",
  "notifications.manage",
  "announcements.create",
  "reports.view_team",
  "reports.view_all",
  "reports.export",
  "reports.manage",
  "audit.view_all",
  "audit.export",
  "dashboard.view_team",
  "dashboard.view_all",
];

function union(...groups: readonly (readonly PermissionCode[])[]): PermissionCode[] {
  return [...new Set(groups.flat())].sort();
}

/**
 * The matrix from docs/00-overview-and-roles.md §6.4, as data.
 * The seed writes exactly this; nothing else may grant permissions.
 */
export const ROLE_PERMISSIONS: Record<SystemRole, readonly PermissionCode[]> = {
  super_admin: [...PERMISSION_CODES].sort(),
  hr_admin: union(SELF_SERVICE, HR_ADMIN_ONLY),
  manager: union(SELF_SERVICE, MANAGER_ONLY),
  employee: union(SELF_SERVICE),
};

// ─────────────────────────────────────────────── evaluation

export interface PermissionHolder {
  permissions: ReadonlySet<PermissionCode> | readonly PermissionCode[];
}

function has(holder: PermissionHolder, code: PermissionCode): boolean {
  const p = holder.permissions;
  return p instanceof Set ? p.has(code) : (p as readonly PermissionCode[]).includes(code);
}

/** Cosmetic in the UI, authoritative on the server. */
export function can(holder: PermissionHolder, code: PermissionCode): boolean {
  return has(holder, code);
}

export function canAny(holder: PermissionHolder, ...codes: PermissionCode[]): boolean {
  return codes.some((c) => has(holder, c));
}

export function canAll(holder: PermissionHolder, ...codes: PermissionCode[]): boolean {
  return codes.every((c) => has(holder, c));
}

/** Throws 403 unless the holder has the permission. */
export function requirePermission(holder: PermissionHolder, code: PermissionCode): void {
  if (!has(holder, code)) {
    throw new ForbiddenError(`Missing permission: ${code}`);
  }
}

/**
 * Resolve the widest data scope a caller holds for a module, so services can
 * pick a query filter without re-deriving the tier at each call site.
 */
export type Scope = "all" | "team" | "own" | "none";

export function resolveScope(holder: PermissionHolder, module: Module): Scope {
  if (has(holder, `${module}.view_all` as PermissionCode)) return "all";
  if (has(holder, `${module}.view_team` as PermissionCode)) return "team";
  if (has(holder, `${module}.view_own` as PermissionCode)) return "own";
  return "none";
}

export function isPermissionCode(value: string): value is PermissionCode {
  return (PERMISSION_CODES as readonly string[]).includes(value);
}

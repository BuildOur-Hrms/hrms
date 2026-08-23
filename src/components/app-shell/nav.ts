import type { PermissionCode } from "@/lib/permissions";

/**
 * The sidebar, as data.
 *
 * Entries are filtered by permission, never by role name — that is the whole
 * point of the permission model, and it means a custom role in Phase 3 gets a
 * correct sidebar with no code change here.
 *
 * Navigation visibility is cosmetic. Every destination re-checks server-side;
 * hiding a link is a courtesy, not a control.
 *
 * Icons are named rather than imported here. The filtering runs in the server
 * layout and the result is handed to a client component, and React cannot
 * serialise a component function across that boundary — passing `Home` instead
 * of `"home"` throws at render time, which no type check or production build
 * will catch for you. The client resolves the name through `./icons`.
 */

export type NavIconName =
  | "home"
  | "profile"
  | "team"
  | "employees"
  | "departments"
  | "shifts"
  | "attendance"
  | "company"
  | "locations"
  | "roles"
  | "settings"
  | "audit";

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconName;
  /** Shown when the user holds any one of these. Empty = always shown. */
  permissions: PermissionCode[];
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "",
    items: [{ label: "Dashboard", href: "/dashboard", icon: "home", permissions: [] }],
  },
  {
    label: "My space",
    items: [
      { label: "My profile", href: "/me/profile", icon: "profile", permissions: [] },
      {
        label: "My attendance",
        href: "/me/attendance",
        icon: "attendance",
        permissions: ["attendance.view_own"],
      },
    ],
  },
  {
    label: "Team",
    items: [
      {
        label: "My team",
        href: "/team",
        icon: "team",
        permissions: ["employee.view_team"],
      },
    ],
  },
  {
    label: "People",
    items: [
      {
        label: "Employees",
        href: "/hr/employees",
        icon: "employees",
        permissions: ["employee.view_all"],
      },
      {
        label: "Departments",
        href: "/hr/departments",
        icon: "departments",
        permissions: ["department.manage", "designation.manage"],
      },
      {
        label: "Shifts",
        href: "/hr/shifts",
        icon: "shifts",
        permissions: ["shifts.manage"],
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        label: "Company",
        href: "/admin/company",
        icon: "company",
        permissions: ["company.manage"],
      },
      {
        label: "Locations",
        href: "/admin/locations",
        icon: "locations",
        permissions: ["company.manage"],
      },
      { label: "Roles", href: "/admin/roles", icon: "roles", permissions: ["roles.view_all"] },
      {
        label: "Settings",
        href: "/admin/settings",
        icon: "settings",
        permissions: ["settings.manage"],
      },
      {
        label: "Audit log",
        href: "/admin/audit-logs",
        icon: "audit",
        permissions: ["audit.view_all"],
      },
    ],
  },
];

/**
 * Milestones not yet built. Kept here so the nav's eventual shape is visible
 * in one place rather than scattered across future commits.
 */
export const PLANNED_NAV: { label: string; milestone: string }[] = [
  { label: "Attendance", milestone: "M2 (shifts done)" },
  { label: "Leave", milestone: "M3" },
  { label: "Holidays", milestone: "M3" },
  { label: "Notifications", milestone: "M4" },
];

export function visibleSections(permissions: ReadonlySet<PermissionCode>): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => item.permissions.length === 0 || item.permissions.some((p) => permissions.has(p)),
    ),
  })).filter((section) => section.items.length > 0);
}

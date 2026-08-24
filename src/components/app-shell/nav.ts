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
  | "leave"
  | "notifications"
  | "company"
  | "locations"
  | "roles"
  | "users"
  | "settings"
  | "audit"
  | "reports"
  | "tasks"
  | "hiring"
  | "onboarding"
  | "offboarding";

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
      { label: "Overview", href: "/me", icon: "home", permissions: [] },
      { label: "My profile", href: "/me/profile", icon: "profile", permissions: [] },
      {
        label: "My attendance",
        href: "/me/attendance",
        icon: "attendance",
        permissions: ["attendance.view_own"],
      },
      {
        label: "My leave",
        href: "/me/leave",
        icon: "leave",
        permissions: ["leave.view_own"],
      },
      {
        label: "My interviews",
        href: "/me/interviews",
        icon: "hiring",
        permissions: [],
      },
      {
        label: "My tasks",
        href: "/me/tasks",
        icon: "tasks",
        permissions: ["performance.view_own"],
      },
      {
        label: "Notifications",
        href: "/me/notifications",
        icon: "notifications",
        permissions: [],
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
      {
        label: "Team attendance",
        href: "/team/attendance",
        icon: "attendance",
        permissions: ["attendance.view_team"],
      },
      {
        label: "Leave approvals",
        href: "/team/leave-approvals",
        icon: "leave",
        permissions: ["leave.approve"],
      },
      {
        label: "Team tasks",
        href: "/team/tasks",
        icon: "tasks",
        permissions: ["performance.view_team"],
      },
      {
        label: "Team reports",
        href: "/team/reports",
        icon: "reports",
        permissions: ["reports.view_team"],
      },
    ],
  },
  {
    label: "People",
    items: [
      {
        label: "HR overview",
        href: "/hr",
        icon: "home",
        permissions: ["employee.view_all"],
      },
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
        label: "Attendance",
        href: "/hr/attendance",
        icon: "attendance",
        permissions: ["attendance.view_all"],
      },
      {
        label: "Leave",
        href: "/hr/leave",
        icon: "leave",
        permissions: ["leave.view_all", "leave.manage", "holidays.manage"],
      },
      {
        label: "Shifts",
        href: "/hr/shifts",
        icon: "shifts",
        permissions: ["shifts.manage"],
      },
      {
        label: "Announcements",
        href: "/hr/announcements",
        icon: "notifications",
        permissions: ["announcements.create"],
      },
      {
        label: "Hiring",
        href: "/hr/recruitment",
        icon: "hiring",
        permissions: ["recruitment.view_all"],
      },
      {
        label: "Onboarding",
        href: "/hr/onboarding",
        icon: "onboarding",
        permissions: ["onboarding.view_all"],
      },
      {
        label: "Offboarding",
        href: "/hr/offboarding",
        icon: "offboarding",
        permissions: ["offboarding.view_all"],
      },
      {
        label: "Task completion",
        href: "/hr/tasks",
        icon: "tasks",
        permissions: ["performance.view_all"],
      },
      {
        label: "Reports",
        href: "/hr/reports",
        icon: "reports",
        permissions: ["reports.view_all"],
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        label: "Overview",
        href: "/admin",
        icon: "home",
        permissions: [
          "users.view_all",
          "roles.view_all",
          "company.manage",
          "settings.manage",
          "audit.view_all",
        ],
      },
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
      {
        label: "Users",
        href: "/admin/users",
        icon: "users",
        permissions: ["users.view_all"],
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
export const PLANNED_NAV: { label: string; milestone: string }[] = [];

export function visibleSections(permissions: ReadonlySet<PermissionCode>): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => item.permissions.length === 0 || item.permissions.some((p) => permissions.has(p)),
    ),
  })).filter((section) => section.items.length > 0);
}

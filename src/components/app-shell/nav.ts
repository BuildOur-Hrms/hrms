import {
  Building2,
  CalendarDays,
  ClipboardList,
  FileClock,
  Home,
  MapPin,
  Settings,
  ShieldCheck,
  UserCircle,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
 */

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
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
    items: [{ label: "Dashboard", href: "/dashboard", icon: Home, permissions: [] }],
  },
  {
    label: "My space",
    items: [{ label: "My profile", href: "/me/profile", icon: UserCircle, permissions: [] }],
  },
  {
    label: "Team",
    items: [
      {
        label: "My team",
        href: "/team",
        icon: Users,
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
        icon: Users,
        permissions: ["employee.view_all"],
      },
      {
        label: "Departments",
        href: "/hr/departments",
        icon: ClipboardList,
        permissions: ["department.manage", "designation.manage"],
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        label: "Company",
        href: "/admin/company",
        icon: Building2,
        permissions: ["company.manage"],
      },
      {
        label: "Locations",
        href: "/admin/locations",
        icon: MapPin,
        permissions: ["company.manage"],
      },
      { label: "Roles", href: "/admin/roles", icon: ShieldCheck, permissions: ["roles.view_all"] },
      {
        label: "Settings",
        href: "/admin/settings",
        icon: Settings,
        permissions: ["settings.manage"],
      },
      {
        label: "Audit log",
        href: "/admin/audit-logs",
        icon: FileClock,
        permissions: ["audit.view_all"],
      },
    ],
  },
];

/**
 * Milestones not yet built. Kept here so the nav's eventual shape is visible
 * in one place rather than scattered across future commits.
 *
 * M2 attendance · M3 leave and holidays · M4 notifications and reports.
 */
export const PLANNED_NAV: { label: string; icon: LucideIcon; milestone: string }[] = [
  { label: "Attendance", icon: CalendarDays, milestone: "M2" },
  { label: "Leave", icon: CalendarDays, milestone: "M3" },
];

export function visibleSections(permissions: ReadonlySet<PermissionCode>): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => item.permissions.length === 0 || item.permissions.some((p) => permissions.has(p)),
    ),
  })).filter((section) => section.items.length > 0);
}

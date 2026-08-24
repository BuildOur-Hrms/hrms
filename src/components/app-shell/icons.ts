import {
  BarChart3,
  Briefcase,
  ListChecks,
  Bell,
  Building2,
  ClipboardList,
  CalendarCheck,
  CalendarClock,
  Clock,
  FileClock,
  House,
  MapPin,
  Settings,
  ShieldCheck,
  UserCircle,
  UserCog,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { NavIconName } from "./nav";

/**
 * Name → icon, resolved on the client.
 *
 * This mapping lives apart from `nav.ts` on purpose. The nav config is read by
 * the server layout, which filters it by permission and passes the result to a
 * client component; anything non-serialisable in there — and a React component
 * is not serialisable — fails at render time with "Functions cannot be passed
 * directly to Client Components". Keeping the components on this side of the
 * boundary makes that mistake impossible to repeat.
 */
export const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  home: House,
  profile: UserCircle,
  team: Users,
  employees: Users,
  departments: ClipboardList,
  shifts: Clock,
  attendance: CalendarClock,
  leave: CalendarCheck,
  notifications: Bell,
  company: Building2,
  locations: MapPin,
  roles: ShieldCheck,
  users: UserCog,
  settings: Settings,
  audit: FileClock,
  reports: BarChart3,
  tasks: ListChecks,
  hiring: Briefcase,
};

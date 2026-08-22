import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * One place that decides what each lifecycle status looks like, so a status
 * never reads as "active" on one screen and "Active" on another.
 */
const EMPLOYEE_STATUS: Record<string, { label: string; className: string }> = {
  onboarding: {
    label: "Onboarding",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  },
  active: {
    label: "Active",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  on_notice: {
    label: "On notice",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  },
  exited: {
    label: "Exited",
    className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
};

const USER_STATUS: Record<string, { label: string; className: string }> = {
  invited: {
    label: "Invited",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  },
  active: {
    label: "Active",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  disabled: {
    label: "Disabled",
    className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
};

const EMPLOYMENT_TYPE: Record<string, string> = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  intern: "Intern",
};

export function EmployeeStatusBadge({ status }: { status: string }) {
  const entry = EMPLOYEE_STATUS[status] ?? { label: status, className: "" };
  return (
    <Badge variant="secondary" className={cn("font-medium", entry.className)}>
      {entry.label}
    </Badge>
  );
}

export function UserStatusBadge({ status }: { status: string }) {
  const entry = USER_STATUS[status] ?? { label: status, className: "" };
  return (
    <Badge variant="secondary" className={cn("font-medium", entry.className)}>
      {entry.label}
    </Badge>
  );
}

export function employmentTypeLabel(value: string): string {
  return EMPLOYMENT_TYPE[value] ?? value;
}

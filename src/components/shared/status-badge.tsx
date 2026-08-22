import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * One place that decides what each lifecycle status looks like, so a status
 * never reads as "active" on one screen and "Active" on another.
 *
 * The colours are mixed from the theme's semantic tokens rather than picked
 * out of Tailwind's stock palette, so they carry the same warmth as the rest
 * of the product and follow the theme into dark mode without a second set of
 * hand-picked values.
 */
const TINT = {
  /** Terracotta — the brand tint, for the state the product is drawing you to. */
  brand: "bg-brand-soft text-brand-soft-foreground",
  success: "bg-success/12 text-success dark:bg-success/15",
  warning: "bg-warning/12 text-warning dark:bg-warning/15",
  info: "bg-info/12 text-info dark:bg-info/15",
  neutral: "bg-muted text-muted-foreground",
} as const;

const EMPLOYEE_STATUS: Record<string, { label: string; className: string }> = {
  onboarding: { label: "Onboarding", className: TINT.brand },
  active: { label: "Active", className: TINT.success },
  on_notice: { label: "On notice", className: TINT.warning },
  exited: { label: "Exited", className: TINT.neutral },
};

const USER_STATUS: Record<string, { label: string; className: string }> = {
  invited: { label: "Invited", className: TINT.warning },
  active: { label: "Active", className: TINT.success },
  disabled: { label: "Disabled", className: TINT.neutral },
};

const EMPLOYMENT_TYPE: Record<string, string> = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  intern: "Intern",
};

export function EmployeeStatusBadge({ status }: { status: string }) {
  const entry = EMPLOYEE_STATUS[status] ?? { label: status, className: TINT.neutral };
  return (
    <Badge variant="secondary" className={cn("font-medium", entry.className)}>
      {entry.label}
    </Badge>
  );
}

export function UserStatusBadge({ status }: { status: string }) {
  const entry = USER_STATUS[status] ?? { label: status, className: TINT.neutral };
  return (
    <Badge variant="secondary" className={cn("font-medium", entry.className)}>
      {entry.label}
    </Badge>
  );
}

export function employmentTypeLabel(value: string): string {
  return EMPLOYMENT_TYPE[value] ?? value;
}

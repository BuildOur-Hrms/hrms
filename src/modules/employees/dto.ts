import type { Scope } from "@/lib/permissions";

/**
 * Response shaping (docs/09-security.md §3).
 *
 * Field exposure is decided in exactly one place — here — so a new endpoint
 * cannot accidentally leak a colleague's home address by selecting too much.
 * The rule from the role model: a manager sees their reports' *work* data.
 * Personal contact details, date of birth and home address are visible to the
 * person themselves and to HR, and to nobody else.
 */

export interface EmployeeRow {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string | null;
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
  address: string | null;
  photoKey: string | null;
  employmentType: string;
  status: string;
  joinDate: Date;
  probationEndDate: Date | null;
  confirmationDate: Date | null;
  exitDate: Date | null;
  noticePeriodDays: number | null;
  createdAt: Date;
  department: { id: string; name: string } | null;
  designation: { id: string; title: string; level: number } | null;
  location: { id: string; name: string } | null;
  manager: { id: string; firstName: string; lastName: string | null } | null;
  user: { id: string; email: string; status: string; lastLoginAt: Date | null } | null;
}

/** How much of a record the caller is entitled to see. */
export type Visibility = "self" | "hr" | "team" | "minimal";

export function resolveVisibility(args: { scope: Scope; isSelf: boolean }): Visibility {
  if (args.isSelf) return "self";
  if (args.scope === "all") return "hr";
  if (args.scope === "team") return "team";
  return "minimal";
}

const PERSONAL_FIELDS = ["personalEmail", "dateOfBirth", "address"] as const;

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function toEmployeeDto(row: EmployeeRow, visibility: Visibility) {
  const base = {
    id: row.id,
    employeeCode: row.employeeCode,
    firstName: row.firstName,
    lastName: row.lastName,
    workEmail: row.workEmail,
    phone: row.phone,
    photoKey: row.photoKey,
    employmentType: row.employmentType,
    status: row.status,
    joinDate: dateOnly(row.joinDate),
    department: row.department,
    designation: row.designation,
    location: row.location,
    manager: row.manager,
  };

  if (visibility === "minimal") return base;

  const withEmployment = {
    ...base,
    gender: row.gender,
    probationEndDate: dateOnly(row.probationEndDate),
    confirmationDate: dateOnly(row.confirmationDate),
    exitDate: dateOnly(row.exitDate),
    noticePeriodDays: row.noticePeriodDays,
  };

  // A manager gets the employment picture but not the personal one.
  if (visibility === "team") return withEmployment;

  return {
    ...withEmployment,
    personalEmail: row.personalEmail,
    dateOfBirth: dateOnly(row.dateOfBirth),
    address: row.address,
    createdAt: row.createdAt.toISOString(),
    // Account state is HR/self only: it says whether the person can log in.
    user: row.user,
  };
}

export type EmployeeDto = ReturnType<typeof toEmployeeDto>;

/** The Prisma `select` that feeds `toEmployeeDto`. */
export const employeeSelect = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  workEmail: true,
  personalEmail: true,
  phone: true,
  dateOfBirth: true,
  gender: true,
  address: true,
  photoKey: true,
  employmentType: true,
  status: true,
  joinDate: true,
  probationEndDate: true,
  confirmationDate: true,
  exitDate: true,
  noticePeriodDays: true,
  createdAt: true,
  department: { select: { id: true, name: true } },
  designation: { select: { id: true, title: true, level: true } },
  location: { select: { id: true, name: true } },
  manager: { select: { id: true, firstName: true, lastName: true } },
  user: { select: { id: true, email: true, status: true, lastLoginAt: true } },
} as const;

export { PERSONAL_FIELDS };

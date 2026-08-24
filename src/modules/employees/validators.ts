import { z } from "zod";

/**
 * Employee input schemas.
 *
 * `SELF_EDITABLE_FIELDS` is the security-relevant one: it is the complete set
 * of fields a person may change on their own record. Anything outside it —
 * department, designation, manager, status, join date — is HR's to set, and
 * an employee attempting one gets a 403 rather than a silently ignored field
 * (docs/09-security.md §3).
 */

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Not a real date");

export const employmentTypes = ["full_time", "part_time", "contract", "intern"] as const;
export const employeeStatuses = ["onboarding", "active", "on_notice", "exited"] as const;
export const genders = ["male", "female", "other", "undisclosed"] as const;

/**
 * Setting up your own employee record.
 *
 * A narrowed `createEmployeeSchema`: no manager, no status, no employee code.
 * Those are things the company decides about a person, and this is the one
 * path where the person and the company are the same account — so the fields
 * that would let somebody quietly grade themselves are simply absent rather
 * than validated.
 */
export const setUpOwnProfileSchema = z.object({
  firstName: z.string().trim().min(1, "Required").max(80),
  lastName: z.string().trim().max(80).nullish(),
  workEmail: z.string().trim().toLowerCase().email().max(160).nullish(),
  phone: z.string().trim().max(30).nullish(),

  departmentId: z.string().uuid("Choose a department"),
  designationId: z.string().uuid("Choose a designation"),
  locationId: z.string().uuid("Choose a location"),

  employmentType: z.enum(employmentTypes),
  joinDate: dateOnly,
});
export type SetUpOwnProfileInput = z.infer<typeof setUpOwnProfileSchema>;

export const createEmployeeSchema = z
  .object({
    firstName: z.string().trim().min(1, "Required").max(80),
    lastName: z.string().trim().max(80).nullish(),
    workEmail: z.string().trim().toLowerCase().email().max(160).nullish(),
    personalEmail: z.string().trim().toLowerCase().email().max(160).nullish(),
    phone: z.string().trim().max(30).nullish(),
    dateOfBirth: dateOnly.nullish(),
    gender: z.enum(genders).nullish(),
    address: z.string().trim().max(2000).nullish(),

    departmentId: z.string().uuid("Choose a department"),
    designationId: z.string().uuid("Choose a designation"),
    locationId: z.string().uuid("Choose a location"),
    managerId: z.string().uuid().nullish(),

    employmentType: z.enum(employmentTypes),
    status: z.enum(employeeStatuses).default("onboarding"),
    joinDate: dateOnly,
    probationEndDate: dateOnly.nullish(),
    noticePeriodDays: z.coerce.number().int().min(0).max(365).nullish(),

    /** Optional: HR may set a code explicitly, otherwise one is generated. */
    employeeCode: z
      .string()
      .trim()
      .toUpperCase()
      .max(30)
      .regex(/^[A-Z0-9_-]+$/, "Letters, numbers, hyphen and underscore only")
      .optional(),

    /** Create the login account and email the invite in the same step. */
    invite: z.boolean().default(false),
  })
  .refine((v) => !v.invite || !!v.workEmail, {
    message: "A work email is required to send an invite",
    path: ["workEmail"],
  })
  .refine((v) => !v.probationEndDate || v.probationEndDate >= v.joinDate, {
    message: "Probation cannot end before the join date",
    path: ["probationEndDate"],
  });
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
/**
 * The pre-parse shape. Fields with `.default()` are optional on the way in and
 * required on the way out, so a form must be typed on the input side and the
 * submit handler on the output side.
 */
export type CreateEmployeeFormValues = z.input<typeof createEmployeeSchema>;

/** HR edit. `status` moves through its own endpoint so transitions are guarded. */
export const updateEmployeeSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().max(80).nullish(),
  workEmail: z.string().trim().toLowerCase().email().max(160).nullish(),
  personalEmail: z.string().trim().toLowerCase().email().max(160).nullish(),
  phone: z.string().trim().max(30).nullish(),
  dateOfBirth: dateOnly.nullish(),
  gender: z.enum(genders).nullish(),
  address: z.string().trim().max(2000).nullish(),
  departmentId: z.string().uuid().optional(),
  designationId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  managerId: z.string().uuid().nullish(),
  employmentType: z.enum(employmentTypes).optional(),
  joinDate: dateOnly.optional(),
  probationEndDate: dateOnly.nullish(),
  confirmationDate: dateOnly.nullish(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).nullish(),
});
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

/**
 * What a person may change about themselves. Contact details only — never
 * anything that would alter their place in the org, their pay, or their
 * lifecycle.
 */
export const SELF_EDITABLE_FIELDS = ["phone", "personalEmail", "address"] as const;

export const updateOwnProfileSchema = z.object({
  phone: z.string().trim().max(30).nullish(),
  personalEmail: z.string().trim().toLowerCase().email().max(160).nullish(),
  address: z.string().trim().max(2000).nullish(),
});
export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileSchema>;

export const changeStatusSchema = z.object({
  status: z.enum(employeeStatuses),
  /** Required when moving to `exited`. */
  exitDate: dateOnly.nullish(),
  reason: z.string().trim().max(500).nullish(),
});
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;

export const listEmployeesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  departmentId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  designationId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
  status: z.enum(employeeStatuses).optional(),
  employmentType: z.enum(employmentTypes).optional(),
  sort: z
    .enum(["name:asc", "name:desc", "joinDate:asc", "joinDate:desc", "code:asc", "code:desc"])
    .default("name:asc"),
});
export type ListEmployeesInput = z.infer<typeof listEmployeesSchema>;

export const emergencyContactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  relationship: z.string().trim().min(1).max(60),
  phone: z.string().trim().min(3).max(30),
  isPrimary: z.boolean().default(false),
});
export type EmergencyContactInput = z.infer<typeof emergencyContactSchema>;
/** Pre-parse shape: `isPrimary` has a default, so it is optional on input. */
export type EmergencyContactFormValues = z.input<typeof emergencyContactSchema>;

export const idParamSchema = z.object({ id: z.string().uuid() });
export const contactParamSchema = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
});

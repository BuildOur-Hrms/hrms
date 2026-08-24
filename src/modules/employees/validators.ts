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
/**
 * The complete set of fields somebody may change on their own record.
 *
 * The line is between what is true about a person and what a company decided
 * about them. Their name, birthday and phone number are theirs — they will
 * correct a misspelling or change a surname, and making them ask HR to do it
 * is friction with no safety in it. Department, designation, manager,
 * employment type, join date, status and work email are not on this list and
 * never will be: an employee who could set those could re-grade themselves,
 * which is the whole thing the permission model exists to stop.
 *
 * Name is a deviation from the blueprint, which lists only phone, personal
 * email, address, photo and emergency contacts (docs/02-…, Module 16). It is
 * deliberate, and it is audited like any other change to an employee record.
 */
export const SELF_EDITABLE_FIELDS = [
  "firstName",
  "lastName",
  "phone",
  "personalEmail",
  "address",
  "dateOfBirth",
  "gender",
] as const;

export const updateOwnProfileSchema = z.object({
  firstName: z.string().trim().min(1, "Required").max(80).optional(),
  lastName: z.string().trim().max(80).nullish(),
  phone: z.string().trim().max(30).nullish(),
  personalEmail: z.string().trim().toLowerCase().email().max(160).nullish(),
  address: z.string().trim().max(2000).nullish(),
  dateOfBirth: dateOnly.nullish(),
  gender: z.enum(genders).nullish(),
});
export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileSchema>;

/**
 * Finishing setup after an invite.
 *
 * The same fields, all optional, plus the stamp that stops the prompt coming
 * back. Sent empty by "skip for now" — somebody who does not want to fill
 * this in on their first morning should not be cornered by it.
 */
export const completeProfileSchema = updateOwnProfileSchema;
export type CompleteProfileInput = z.infer<typeof completeProfileSchema>;

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

/**
 * Which account to attach to an employee record.
 *
 * An id rather than an email: the account is picked from a list of accounts
 * that can actually be attached, and matching on a typed address would link
 * whoever happened to own it.
 */
export const linkAccountSchema = z.object({ userId: z.string().uuid() });
export type LinkAccountInput = z.infer<typeof linkAccountSchema>;

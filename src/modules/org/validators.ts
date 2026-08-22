import { z } from "zod";

/**
 * Shared by the API and the forms. Every write endpoint validates against
 * exactly one of these, which is also the mass-assignment defence: a field
 * that is not in the schema cannot reach the database, whatever the client
 * puts in the body (docs/09-security.md §3).
 */

/** Codes are used in URLs, imports and reports, so keep them boring. */
export const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, "At least 2 characters")
  .max(30)
  .regex(/^[A-Z0-9_-]+$/, "Letters, numbers, hyphen and underscore only");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

// ── company

export const updateCompanySchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  legalName: z.string().trim().max(200).nullish(),
  address: z.string().trim().max(2000).nullish(),
  contactEmail: z.string().trim().toLowerCase().email().max(160).nullish(),
  timezone: z.string().trim().min(1).max(64).optional(),
  currency: z.string().trim().toUpperCase().length(3).optional(),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

// ── locations

export const createLocationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: codeSchema,
  address: z.string().trim().max(2000).nullish(),
  /** Falls back to the company timezone when omitted. */
  timezone: z.string().trim().min(1).max(64).nullish(),
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = createLocationSchema.partial();
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

// ── departments

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: codeSchema,
  headEmployeeId: z.string().uuid().nullish(),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = createDepartmentSchema.partial();
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

// ── designations

export const createDesignationSchema = z.object({
  title: z.string().trim().min(2).max(120),
  code: codeSchema,
  /** Seniority ladder position; used for ordering, not for permissions. */
  level: z.coerce.number().int().min(1).max(20).default(1),
});
export type CreateDesignationInput = z.infer<typeof createDesignationSchema>;

export const updateDesignationSchema = createDesignationSchema.partial();
export type UpdateDesignationInput = z.infer<typeof updateDesignationSchema>;

export const idParamSchema = z.object({ id: z.string().uuid() });

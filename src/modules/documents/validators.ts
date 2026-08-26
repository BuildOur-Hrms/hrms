import { z } from "zod";

import { queryBoolean } from "@/lib/validation";

/**
 * What may be said to the document endpoints.
 */

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Not a real date");

export const idParamSchema = z.object({ id: z.string().uuid() });

export const categorySchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(30)
    .regex(/^[A-Z0-9_]+$/, "Letters, numbers and underscore only"),
  name: z.string().trim().min(1, "Required").max(80),
  employeeUploadable: z.boolean().default(false),
  /** Off by default: the safe answer for a category nobody has thought about. */
  managerVisible: z.boolean().default(false),
  expiryRequired: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});
export type CategoryInput = z.infer<typeof categorySchema>;

/**
 * Changing one.
 *
 * Written out rather than derived with `categorySchema.partial()`, which does
 * not do what it looks like it does: `.partial()` makes a field optional
 * without removing its default, so an absent key still arrives as `false` and
 * every guard downstream reads it as a deliberate `false`. Renaming a
 * category would quietly clear `expiryRequired` and `employeeUploadable`
 * along with it. The code is left out because a category's code is what
 * everything else refers to it by.
 */
export const updateCategorySchema = z.object({
  name: z.string().trim().min(1, "Required").max(80).optional(),
  employeeUploadable: z.boolean().optional(),
  managerVisible: z.boolean().optional(),
  expiryRequired: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
});
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

/**
 * Asking for somewhere to put a file.
 *
 * The size and type are declared here so an oversized or unwanted file is
 * refused before a URL exists for it, rather than after it has been uploaded.
 */
export const requestUploadSchema = z.object({
  /** Null for a company document — a policy, the handbook. */
  employeeId: z.string().uuid().nullish(),
  categoryId: z.string().uuid(),
  name: z.string().trim().min(1, "Give it a name").max(160),
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(100),
  sizeBytes: z.coerce
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024),
  expiryDate: dateOnly.nullish(),
  /** The document this one supersedes, if it is a replacement. */
  replacesId: z.string().uuid().nullish(),
});
export type RequestUploadInput = z.infer<typeof requestUploadSchema>;

export const listDocumentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  employeeId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  /** Company-level documents — the ones with no owner. */
  companyOnly: queryBoolean.optional(),
  mine: queryBoolean.optional(),
  expiringWithinDays: z.coerce.number().int().min(1).max(365).optional(),
  includeArchived: queryBoolean.optional(),
});
export type ListDocumentsInput = z.infer<typeof listDocumentsSchema>;

export const updateDocumentSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  expiryDate: dateOnly.nullish(),
  /** HR marking that somebody has actually looked at it. */
  verified: z.boolean().optional(),
});
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

import { z } from "zod";

import { PERMISSION_CODES } from "@/lib/permissions";

/**
 * What may be said to the role endpoints.
 */

export const idParamSchema = z.object({ id: z.string().uuid() });

/**
 * A permission has to be one the platform actually defines.
 *
 * Checked here rather than only in the service so an unknown code is a 400
 * naming the field, not a foreign-key error from the database. Whether the
 * caller may *grant* the codes they named is a different question, and one
 * the service answers.
 */
const permissionCode = z.enum(PERMISSION_CODES as unknown as [string, ...string[]]);

const roleName = z
  .string()
  .trim()
  .min(2, "Give the role a name")
  .max(60)
  // No spaces or punctuation: role names appear in the permission matrix, in
  // audit rows and in the seed's role table, and a name that needs quoting in
  // any of those is a name that will be wrong in one of them.
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Lower case letters, numbers and underscores, starting with a letter",
  );

export const createRoleSchema = z.object({
  name: roleName,
  description: z.string().trim().max(200).nullish(),
  permissions: z.array(permissionCode).max(PERMISSION_CODES.length).default([]),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  description: z.string().trim().max(200).nullish(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const setPermissionsSchema = z.object({
  permissions: z.array(permissionCode).max(PERMISSION_CODES.length),
});
export type SetPermissionsInput = z.infer<typeof setPermissionsSchema>;

import { z } from "zod";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, checkPasswordPolicy } from "./policy";

/**
 * Shared between the API and the forms — react-hook-form uses the same schema
 * the route validates with, so the two can never disagree about what is valid.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(160)
  .email("Enter a valid email address");

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH)
  .superRefine((value, ctx) => {
    const result = checkPasswordPolicy(value);
    for (const problem of result.problems) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    }
  });

export const loginSchema = z.object({
  email: emailSchema,
  // Not `passwordSchema`: an existing password set under an older policy must
  // still be able to log in (and then be asked to change it).
  password: z.string().min(1, "Enter your password").max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(128),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const acceptInviteSchema = resetPasswordSchema;
export type AcceptInviteInput = ResetPasswordInput;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

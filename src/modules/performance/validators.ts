import { z } from "zod";

import { queryBoolean } from "@/lib/validation";

/**
 * What may be said to the performance endpoints.
 */

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Not a real date");

const rating = z.coerce.number().int().min(1, "1 to 5").max(5, "1 to 5");

export const idParamSchema = z.object({ id: z.string().uuid() });

export const createCycleSchema = z
  .object({
    name: z.string().trim().min(1, "Required").max(120),
    periodStart: dateOnly,
    periodEnd: dateOnly,
    reviewDeadline: dateOnly.nullish(),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: "The period cannot end before it starts",
    path: ["periodEnd"],
  })
  .refine((v) => !v.reviewDeadline || v.reviewDeadline >= v.periodStart, {
    message: "The deadline cannot fall before the period begins",
    path: ["reviewDeadline"],
  });
export type CreateCycleInput = z.infer<typeof createCycleSchema>;

export const cycleStatusSchema = z.object({
  status: z.enum(["draft", "active", "review", "closed"]),
});
export type CycleStatusInput = z.infer<typeof cycleStatusSchema>;

export const listCyclesSchema = z.object({
  status: z.enum(["draft", "active", "review", "closed"]).optional(),
});
export type ListCyclesInput = z.infer<typeof listCyclesSchema>;

export const addGoalSchema = z.object({
  employeeId: z.string().uuid().nullish(),
  title: z.string().trim().min(1, "Required").max(160),
  description: z.string().trim().max(2000).nullish(),
  weight: z.coerce.number().int().min(1).max(100).default(1),
  dueDate: dateOnly.nullish(),
});
export type AddGoalInput = z.infer<typeof addGoalSchema>;

export const selfReviewSchema = z.object({
  rating,
  comments: z.string().trim().min(1, "Say something").max(4000),
});
export type SelfReviewInput = z.infer<typeof selfReviewSchema>;

export const managerReviewSchema = z.object({
  rating,
  comments: z.string().trim().min(1, "Say something").max(4000),
});
export type ManagerReviewInput = z.infer<typeof managerReviewSchema>;

export const finalRatingSchema = z.object({
  /**
   * HR's settled figure.
   *
   * Nullable so it can be cleared: a rating set during calibration and then
   * reconsidered should be removable without inventing a placeholder number.
   */
  finalRating: rating.nullish(),
});
export type FinalRatingInput = z.infer<typeof finalRatingSchema>;

export const reopenReviewSchema = z.object({
  to: z.enum(["pending_self", "pending_manager"]),
});
export type ReopenReviewInput = z.infer<typeof reopenReviewSchema>;

export const listReviewsSchema = z.object({
  cycleId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  mine: queryBoolean.optional(),
  /** Reviews this person has to write, rather than ones written about them. */
  toWrite: queryBoolean.optional(),
});
export type ListReviewsInput = z.infer<typeof listReviewsSchema>;

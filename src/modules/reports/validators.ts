import { z } from "zod";

import { dateOnlySchema } from "@/modules/attendance/validators";

/**
 * One schema for every report.
 *
 * Reports share a filter vocabulary, so validating them together keeps a
 * single generic screen and a single generic endpoint honest: a report reads
 * the fields it declared in the catalog and ignores the rest. A filter that
 * does not apply is therefore harmless rather than a 422 — which matters
 * because the screen carries filters across when you switch reports.
 */

export const reportScopeSchema = z.enum(["all", "team"]);
export type ReportScope = z.infer<typeof reportScopeSchema>;

export const groupBySchema = z.enum(["department", "location", "employmentType", "status"]);

export const reportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  /** Omitted means "the widest scope this caller holds". */
  scope: reportScopeSchema.optional(),

  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),

  departmentId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  leaveTypeId: z.string().uuid().optional(),
  status: z.enum(["onboarding", "active", "on_notice", "exited"]).optional(),
  employmentType: z.enum(["full_time", "part_time", "contract", "intern"]).optional(),
  lateThresholdMinutes: z.coerce.number().int().min(0).max(480).optional(),
  groupBy: groupBySchema.optional(),

  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(60).optional(),
  actorUserId: z.string().uuid().optional(),
});
export type ReportQueryInput = z.infer<typeof reportQuerySchema>;

export const reportParamsSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,40}$/, "Unknown report"),
});

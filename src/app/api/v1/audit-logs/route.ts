import { z } from "zod";

import { list, withApi } from "@/lib/api";
import { listAuditLogs } from "@/modules/audit/service";

export const runtime = "nodejs";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(60).optional(),
  entityId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});
type Query = z.infer<typeof querySchema>;

export const GET = withApi<Record<string, never>, Query>(
  { permission: "audit.view_all", query: querySchema },
  async ({ ctx, query }) => {
    const result = await listAuditLogs(ctx, query);
    return list(result.data, result.meta);
  },
);

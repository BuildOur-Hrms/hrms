import { NextResponse } from "next/server";
import { z } from "zod";

import { withApi } from "@/lib/api";
import { csvFilename } from "@/lib/csv";
import { AUDIT_EXPORT_LIMIT, exportAuditLogs } from "@/modules/audit/service";

export const runtime = "nodejs";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const querySchema = z.object({
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(60).optional(),
  entityId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});
type Query = z.infer<typeof querySchema>;

/**
 * GET /api/v1/audit-logs/export
 *
 * A separate permission from viewing, because they are separate risks: reading
 * the trail on a screen leaves it in the system, and downloading it does not.
 *
 * The export writes its own audit row before returning. The one action nobody
 * thinks to log is the one that takes the log out of the building.
 */
export const GET = withApi<Record<string, never>, Query>(
  { permission: "audit.export", query: querySchema, rateLimit: "expensive" },
  async ({ ctx, query }) => {
    const { csv, count, truncated } = await exportAuditLogs(ctx, query);

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${csvFilename("audit-log")}"`,
        "Cache-Control": "no-store, max-age=0",
        "X-Row-Count": String(count),
        // Said out loud rather than left to be noticed. A truncated export
        // that looks complete is the one somebody files as evidence.
        ...(truncated ? { "X-Truncated-At": String(AUDIT_EXPORT_LIMIT) } : {}),
      },
    });
  },
);

import { listAuditLogs } from "@/modules/audit/service";

import { fullName, humanize, type ReportResult, type RunnerArgs } from "./runner";

/**
 * R16 — Audit activity.
 *
 * Reads through the audit service rather than the table, so the report and
 * `/admin/audit-logs` can never disagree about what is visible or how a date
 * range is interpreted. The catalog entry also demands `audit.view_all`: the
 * trail is the one report where "can run reports" is not enough.
 *
 * List only, by design — an average of a security event means nothing.
 */
export async function auditActivity({ ctx, query }: RunnerArgs): Promise<ReportResult> {
  const result = await listAuditLogs(ctx, {
    page: query.page,
    pageSize: query.pageSize,
    ...(query.action ? { action: query.action } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
  });

  return {
    rows: result.data.map((row) => ({
      id: row.id,
      at: row.createdAt.toISOString(),
      actor: actorLabel(row.actor),
      action: row.action,
      entity: humanize(row.entityType),
      summary: summarize(row),
    })),
    total: result.meta.total,
    kpis: [],
  };
}

type AuditRow = Awaited<ReturnType<typeof listAuditLogs>>["data"][number];

function actorLabel(actor: AuditRow["actor"]): string {
  // Cron jobs and the accrual worker write rows with no actor. Calling that
  // "unknown" would be wrong — it is known, it is the system.
  if (!actor) return "System";
  return actor.employee ? fullName(actor.employee) : actor.email;
}

/**
 * One readable line about what changed, without leaking the payload.
 *
 * Field *names* are safe to show and are what a reviewer scans for; values
 * are not, and stay in the detail view where the viewer already gates them.
 */
function summarize(row: AuditRow): string {
  const after = row.after;
  if (after && typeof after === "object" && !Array.isArray(after)) {
    const fields = after as Record<string, unknown>;
    const changed = fields["changedFields"];
    if (Array.isArray(changed) && changed.length > 0) {
      return `Changed ${changed.map(String).join(", ")}`;
    }
    const keys = Object.keys(fields);
    if (keys.length > 0) return `Set ${keys.slice(0, 6).join(", ")}`;
  }
  if (row.before && typeof row.before === "object") return "Previous values recorded";
  return row.entityId ?? "—";
}

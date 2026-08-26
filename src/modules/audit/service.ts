import type { RequestContext } from "@/lib/context";
import { withPlatform, type TenantTx } from "@/lib/db";
import { toCsv, type CsvColumn } from "@/lib/csv";
import { globalSingleton } from "@/lib/global-store";
import {
  emit,
  type DomainEventMap,
  type DomainEventName,
  type EventActor,
  onAny,
} from "@/lib/events";
import { logger } from "@/lib/logger";

/**
 * Append-only audit trail (docs/09-security.md §10).
 *
 * Rows are written by subscribing to every domain event rather than by asking
 * each service to remember. When the emitting service passes its transaction,
 * the audit row commits with the change — an approved leave request and the
 * record that someone approved it can never disagree.
 *
 * Immutability is enforced in the database by a trigger, not by convention:
 * see the `audit_append_only` migration.
 */

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
}

type PayloadOf<N extends DomainEventName> = DomainEventMap[N];

/**
 * Which events become audit rows, and what entity each one is about.
 *
 * An event absent from this map is deliberately not audited (nothing in the
 * current catalog). Anything touching identity, permissions, or people data
 * belongs here.
 */
const AUDIT_MAP: {
  [N in DomainEventName]?: (payload: PayloadOf<N>) => Omit<AuditEntry, "action">;
} = {
  "auth.logged_in": (p) => ({ entityType: "user", entityId: p.userId }),
  "auth.login_failed": (p) => ({
    entityType: "user",
    entityId: null,
    after: { email: p.email, reason: p.reason },
  }),
  "auth.logged_out": (p) => ({ entityType: "user", entityId: p.userId }),
  "auth.password_reset_requested": (p) => ({ entityType: "user", entityId: p.userId }),
  "auth.password_reset": (p) => ({ entityType: "user", entityId: p.userId }),
  "auth.invite_accepted": (p) => ({ entityType: "user", entityId: p.userId }),
  "auth.account_locked": (p) => ({
    entityType: "user",
    entityId: p.userId,
    after: { lockedUntil: p.until },
  }),

  "user.invited": (p) => ({
    entityType: "user",
    entityId: p.userId,
    after: { email: p.email, employeeId: p.employeeId },
  }),
  "user.enabled": (p) => ({ entityType: "user", entityId: p.userId }),
  "user.disabled": (p) => ({ entityType: "user", entityId: p.userId }),
  "user.roles_changed": (p) => ({
    entityType: "user",
    entityId: p.userId,
    after: { roles: p.roles },
  }),
  "user.linked_to_employee": (p) => ({
    entityType: "user",
    entityId: p.userId,
    after: { employeeId: p.employeeId },
  }),

  "checklist.template_saved": (p) => ({
    entityType: "checklist_template",
    entityId: p.templateId,
    after: { kind: p.kind, name: p.name },
  }),
  "checklist.started": (p) => ({
    entityType: "employee",
    entityId: p.employeeId,
    after: { kind: p.kind, templateId: p.templateId, taskCount: p.taskCount },
  }),
  "checklist.task_settled": (p) => ({
    entityType: "checklist_task",
    entityId: p.taskId,
    after: { employeeId: p.employeeId, kind: p.kind, status: p.status },
  }),

  "offboarding.submitted": (p) => ({
    entityType: "offboarding_request",
    entityId: p.requestId,
    after: { employeeId: p.employeeId },
  }),
  "offboarding.approved": (p) => ({
    entityType: "offboarding_request",
    entityId: p.requestId,
    after: { employeeId: p.employeeId },
  }),
  "offboarding.confirmed": (p) => ({
    entityType: "offboarding_request",
    entityId: p.requestId,
    after: { employeeId: p.employeeId, lastWorkingDay: p.lastWorkingDay },
  }),
  "offboarding.cleared": (p) => ({
    entityType: "offboarding_request",
    entityId: p.requestId,
    after: { employeeId: p.employeeId },
  }),
  "offboarding.settled": (p) => ({
    entityType: "offboarding_request",
    entityId: p.requestId,
    after: { employeeId: p.employeeId },
  }),
  "offboarding.completed": (p) => ({
    entityType: "offboarding_request",
    entityId: p.requestId,
    after: { employeeId: p.employeeId },
  }),
  "offboarding.cancelled": (p) => ({
    entityType: "offboarding_request",
    entityId: p.requestId,
    after: { employeeId: p.employeeId },
  }),

  "performance.cycle_created": (p) => ({
    entityType: "performance_cycle",
    entityId: p.cycleId,
    after: { name: p.name },
  }),
  "performance.cycle_status_changed": (p) => ({
    entityType: "performance_cycle",
    entityId: p.cycleId,
    before: { status: p.from },
    after: { status: p.to, reviewsOpened: p.opened },
  }),
  "performance.goal_added": (p) => ({
    entityType: "job_task",
    entityId: p.goalId,
    after: { cycleId: p.cycleId, employeeId: p.employeeId },
  }),
  "performance.goals_approved": (p) => ({
    entityType: "employee",
    entityId: p.employeeId,
    after: { cycleId: p.cycleId, goalsApproved: p.count },
  }),
  "performance.self_submitted": (p) => ({
    entityType: "performance_review",
    entityId: p.reviewId,
    after: { employeeId: p.employeeId, half: "self" },
  }),
  "performance.manager_submitted": (p) => ({
    entityType: "performance_review",
    entityId: p.reviewId,
    after: { employeeId: p.employeeId, half: "manager" },
  }),
  "performance.final_rating_set": (p) => ({
    entityType: "performance_review",
    entityId: p.reviewId,
    after: { employeeId: p.employeeId, finalRating: p.rating },
  }),
  "performance.review_reopened": (p) => ({
    entityType: "performance_review",
    entityId: p.reviewId,
    after: { employeeId: p.employeeId, sentBackTo: p.to },
  }),

  "payroll.component_saved": (p) => ({
    entityType: "salary_component",
    entityId: p.componentId,
    after: { code: p.code },
  }),
  "payroll.salary_assigned": (p) => ({
    entityType: "employee",
    entityId: p.employeeId,
    // The amounts are deliberately not in the audit trail. Who changed
    // somebody's pay and when is the useful record; copying the figures into
    // a second table spreads salary further than it needs to go.
    after: { salaryId: p.salaryId, effectiveFrom: p.effectiveFrom },
  }),
  "payroll.run_created": (p) => ({
    entityType: "payroll_run",
    entityId: p.runId,
    after: { year: p.year, month: p.month },
  }),
  "payroll.run_approved": (p) => ({
    entityType: "payroll_run",
    entityId: p.runId,
    after: { year: p.year, month: p.month, payslips: p.payslips },
  }),
  "payroll.run_paid": (p) => ({ entityType: "payroll_run", entityId: p.runId }),

  "document.category_saved": (p) => ({
    entityType: "document_category",
    entityId: p.categoryId,
    after: { code: p.code },
  }),
  "document.uploaded": (p) => ({
    entityType: "document",
    entityId: p.documentId,
    after: { employeeId: p.employeeId, categoryId: p.categoryId },
  }),
  /*
   * Reads are audited here and almost nowhere else.
   *
   * Who looked at somebody's passport is the question this trail exists to
   * answer, and unlike a screen view a download leaves the building.
   */
  "document.downloaded": (p) => ({
    entityType: "document",
    entityId: p.documentId,
    after: { employeeId: p.employeeId },
  }),
  "document.updated": (p) => ({ entityType: "document", entityId: p.documentId }),
  "document.archived": (p) => ({
    entityType: "document",
    entityId: p.documentId,
    // Why it went, not just that it did: a replacement and a retirement look
    // identical in the row otherwise.
    ...(p.replacedBy ? { after: { replacedBy: p.replacedBy } } : {}),
  }),

  "employee.created": (p) => ({ entityType: "employee", entityId: p.employeeId, after: p.after }),
  "employee.updated": (p) => ({
    entityType: "employee",
    entityId: p.employeeId,
    before: p.before,
    after: p.after,
  }),
  "employee.status_changed": (p) => ({
    entityType: "employee",
    entityId: p.employeeId,
    before: { status: p.from },
    after: { status: p.to },
  }),
  "employee.deleted": (p) => ({ entityType: "employee", entityId: p.employeeId }),

  "attendance.manual_entry": (p) => ({
    entityType: "attendance_record",
    entityId: p.correctionId,
    after: {
      employeeId: p.employeeId,
      workDate: p.workDate,
      entered: p.entered,
      reason: p.reason,
    },
  }),

  // Only the assignment side is audited. Somebody nudging their own progress
  // bar a dozen times a week is noise, and burying the row that says "your
  // manager set you a target" under it is how an audit trail stops being read.
  "task.created": (p) => ({
    entityType: "job_task",
    entityId: p.taskId,
    after: {
      employeeId: p.employeeId,
      origin: p.origin,
      title: p.title,
      weight: p.weight,
      period: p.period,
    },
  }),
  "task.deleted": (p) => ({
    entityType: "job_task",
    entityId: p.taskId,
    before: { employeeId: p.employeeId, origin: p.origin, title: p.title },
  }),

  "recruitment.job_changed": (p) => ({
    entityType: "job_posting",
    entityId: p.jobPostingId,
    after: { title: p.title, action: p.action },
  }),
  "recruitment.candidate_changed": (p) => ({
    entityType: "candidate",
    entityId: p.candidateId,
    after: { email: p.email, action: p.action },
  }),
  "recruitment.application_moved": (p) => ({
    entityType: "application",
    entityId: p.applicationId,
    before: p.from ? { stage: p.from } : undefined,
    after: { stage: p.to, job: p.jobTitle, reason: p.reason },
  }),
  "recruitment.interview_scheduled": (p) => ({
    entityType: "interview",
    entityId: p.interviewId,
    after: {
      applicationId: p.applicationId,
      interviewerId: p.interviewerId,
      scheduledAt: p.scheduledAt,
      round: p.roundName,
    },
  }),
  // The verdict, not the words. Written feedback is a candidate's personal
  // data and belongs in the record it was written on, not copied into a trail
  // that a different permission opens.
  "recruitment.feedback_submitted": (p) => ({
    entityType: "interview",
    entityId: p.interviewId,
    after: { recommendation: p.recommendation, rating: p.rating },
  }),
  "recruitment.offer_changed": (p) => ({
    entityType: "offer",
    entityId: p.offerId,
    after: { applicationId: p.applicationId, action: p.action, ctc: p.ctc },
  }),
  "recruitment.converted": (p) => ({
    entityType: "application",
    entityId: p.applicationId,
    after: {
      offerId: p.offerId,
      employeeId: p.employeeId,
      employeeCode: p.employeeCode,
      candidateEmail: p.candidateEmail,
    },
  }),

  "audit.exported": (p) => ({
    entityType: "audit_log",
    entityId: null,
    after: { count: p.count, filters: p.filters },
  }),

  "org.location_changed": (p) => ({ entityType: "location", entityId: p.locationId }),
  "org.department_changed": (p) => ({ entityType: "department", entityId: p.departmentId }),
  "org.designation_changed": (p) => ({ entityType: "designation", entityId: p.designationId }),
  "org.company_updated": (p) => ({
    entityType: "company",
    entityId: null,
    after: { changedFields: p.changedFields },
  }),
  "org.setting_changed": (p) => ({
    entityType: "system_setting",
    entityId: null,
    after: { key: p.key },
  }),
};

/** jsonb columns reject `undefined`; normalise it away. */
function toJson(value: unknown): object | undefined {
  if (value === undefined || value === null) return undefined;
  return value as object;
}

async function insert(db: TenantTx, actor: EventActor, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      companyId: actor.companyId,
      actorUserId: actor.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: toJson(entry.before) as never,
      after: toJson(entry.after) as never,
      ip: actor.ip ?? null,
      userAgent: actor.userAgent?.slice(0, 255) ?? null,
    },
  });
}

/**
 * Write an audit row directly. Services that already know exactly what they
 * changed can call this instead of emitting an event.
 */
export async function record(ctx: RequestContext, entry: AuditEntry): Promise<void> {
  await insert(
    ctx.db,
    {
      userId: ctx.userId,
      companyId: ctx.companyId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    },
    entry,
  );
}

/**
 * Subscribe the audit writer to the event bus. Called from
 * `src/lib/bootstrap.ts`.
 */
export function registerAuditSubscriber(): void {
  const state = globalSingleton("__hrms_audit_subscriber__", () => ({ registered: false }));
  if (state.registered) return;
  state.registered = true;

  onAny(async (event) => {
    const map = AUDIT_MAP as Record<
      string,
      ((payload: unknown) => Omit<AuditEntry, "action">) | undefined
    >;
    const resolve = map[event.name];
    if (!resolve) return;

    const entry: AuditEntry = { action: event.name, ...resolve(event.payload) };

    try {
      if (event.actor.db) {
        await insert(event.actor.db, event.actor, entry);
      } else {
        // No tenant transaction — pre-auth flows. Still audited, just not
        // atomically with whatever triggered it.
        await withPlatform((tx) => insert(tx as unknown as TenantTx, event.actor, entry));
      }
    } catch (error) {
      // An audit failure must be loud, but it must not swallow the user's
      // action after the fact. `emit` already isolates subscriber failures;
      // this log is what alerting watches.
      logger.error(
        { err: error, event: event.name, requestId: event.actor.requestId },
        "AUDIT WRITE FAILED",
      );
      throw error;
    }
  });
}

// ─────────────────────────────────────────────── viewer

export interface ListAuditInput {
  page: number;
  pageSize: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
}

/**
 * The audit viewer feed (`/admin/audit-logs`), restricted to `audit.view_all`.
 *
 * Ordered by `created_at DESC` to match the index; `before`/`after` are
 * returned as-is because the writer already decided what was safe to keep.
 */
function nextDay(dateOnly: string): Date {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

export async function listAuditLogs(ctx: RequestContext, input: ListAuditInput) {
  const where: Record<string, unknown> = {};
  if (input.action) where["action"] = { startsWith: input.action };
  if (input.entityType) where["entityType"] = input.entityType;
  if (input.entityId) where["entityId"] = input.entityId;
  if (input.actorUserId) where["actorUserId"] = input.actorUserId;

  if (input.from || input.to) {
    where["createdAt"] = {
      ...(input.from ? { gte: new Date(`${input.from}T00:00:00.000Z`) } : {}),
      // Exclusive upper bound at the *start of the next day*, so "to = today"
      // includes everything that happened today — which is what a person
      // typing a date range means.
      ...(input.to ? { lt: nextDay(input.to) } : {}),
    };
  }

  const [rows, total] = await Promise.all([
    ctx.db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        before: true,
        after: true,
        ip: true,
        createdAt: true,
        actor: {
          select: {
            id: true,
            email: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        },
      },
    }),
    ctx.db.auditLog.count({ where }),
  ]);

  return { data: rows, meta: { page: input.page, pageSize: input.pageSize, total } };
}

/** Distinct action codes present in this tenant, for the filter dropdown. */
export async function auditActions(ctx: RequestContext): Promise<string[]> {
  const rows = await ctx.db.auditLog.findMany({
    distinct: ["action"],
    orderBy: { action: "asc" },
    select: { action: true },
    take: 200,
  });
  return rows.map((r) => r.action);
}

// ─────────────────────────────────────────────── export

/**
 * How many rows one export may take.
 *
 * A cap rather than a stream, for now. The number is stated in the response
 * headers and in the notice on the screen, because a truncated export that
 * looks complete is worse than one that refuses: somebody will file it as
 * evidence.
 */
export const AUDIT_EXPORT_LIMIT = 10_000;

const EXPORT_COLUMNS: CsvColumn<AuditExportRow>[] = [
  { key: "at", label: "When", value: (r) => r.createdAt.toISOString() },
  { key: "actor", label: "Actor", value: (r) => r.actor?.email ?? "system" },
  {
    key: "actorName",
    label: "Actor name",
    value: (r) =>
      r.actor?.employee
        ? [r.actor.employee.firstName, r.actor.employee.lastName].filter(Boolean).join(" ")
        : "",
  },
  { key: "action", label: "Action" },
  { key: "entityType", label: "Entity" },
  { key: "entityId", label: "Entity id" },
  { key: "ip", label: "IP" },
  {
    key: "changed",
    label: "Changed fields",
    value: (r) => changedFields(r.before, r.after).join(" "),
  },
];

interface AuditExportRow {
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: Date;
  actor: { email: string; employee: { firstName: string; lastName: string | null } | null } | null;
}

/**
 * Field *names*, never values.
 *
 * An export is the easiest way for data to leave the building, and the reason
 * somebody exports the audit trail is to see the shape of what happened. The
 * detail drawer in the viewer already gates the values behind a permission;
 * a spreadsheet leaves the building with them in it.
 */
function changedFields(before: unknown, after: unknown): string[] {
  const keys = new Set<string>();
  for (const side of [before, after]) {
    if (side && typeof side === "object" && !Array.isArray(side)) {
      const record = side as Record<string, unknown>;
      const named = record["changedFields"];
      if (Array.isArray(named)) named.forEach((k) => keys.add(String(k)));
      else Object.keys(record).forEach((k) => keys.add(k));
    }
  }
  return [...keys].sort();
}

/**
 * The audit trail as CSV, and a row in the audit trail saying so.
 *
 * Exporting is itself audited (docs/03-modules-platform-and-reports.md
 * §Module 20). The one action nobody would think to log is the one that takes
 * the log out of the system.
 */
export async function exportAuditLogs(
  ctx: RequestContext,
  input: Omit<ListAuditInput, "page" | "pageSize">,
): Promise<{ csv: string; count: number; truncated: boolean }> {
  const result = await listAuditLogs(ctx, {
    ...input,
    page: 1,
    pageSize: AUDIT_EXPORT_LIMIT,
  });

  const rows = result.data as unknown as AuditExportRow[];
  const truncated = result.meta.total > rows.length;

  await emitExport(ctx, rows.length, input);

  return { csv: toCsv(EXPORT_COLUMNS, rows), count: rows.length, truncated };
}

async function emitExport(
  ctx: RequestContext,
  count: number,
  input: Omit<ListAuditInput, "page" | "pageSize">,
): Promise<void> {
  await emit(
    "audit.exported",
    {
      count,
      filters: {
        action: input.action,
        entityType: input.entityType,
        actorUserId: input.actorUserId,
        from: input.from,
        to: input.to,
      },
    },
    {
      userId: ctx.userId,
      companyId: ctx.companyId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      db: ctx.db,
    },
  );
}

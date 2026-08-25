import type { TenantTx } from "./db";
import { globalSingleton } from "./global-store";
import { logger } from "./logger";

/**
 * In-process typed domain events.
 *
 * Services emit; subscribers write audit rows and fan notifications out to the
 * queue. This is what keeps modules from importing each other's plumbing — the
 * employees service does not know the mailer exists.
 *
 * Handlers are awaited but never allowed to fail the emitting operation: a
 * broken notification template must not roll back an approved leave request.
 * Anything that MUST be atomic with the write belongs in the service's
 * transaction, not here.
 */

export interface EventActor {
  userId: string | null;
  companyId: string;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string;
  /**
   * The emitting service's transaction, when there is one. Passing it makes the
   * audit row atomic with the change it describes: if the write rolls back, so
   * does the claim that it happened. Omit it only where no tenant transaction
   * exists — login and password reset, which run before a tenant is known.
   */
  db?: TenantTx;
}

export interface DomainEventMap {
  "auth.logged_in": { userId: string };
  "auth.login_failed": { email: string; reason: "bad_credentials" | "locked" | "disabled" };
  "auth.logged_out": { userId: string };
  "auth.password_reset_requested": { userId: string };
  "auth.password_reset": { userId: string };
  "auth.invite_accepted": { userId: string };
  "auth.account_locked": { userId: string; until: string };

  "user.invited": { userId: string; email: string; employeeId: string | null };
  "user.enabled": { userId: string };
  "user.disabled": { userId: string };
  "user.roles_changed": { userId: string; roles: string[] };
  /// Only ever an account that was never used - see deleteUnusedAccount.
  "user.deleted": { userId: string };
  "user.linked_to_employee": { userId: string; employeeId: string };

  "checklist.template_saved": { templateId: string; kind: string; name: string };
  "checklist.started": {
    employeeId: string;
    kind: string;
    templateId: string;
    taskCount: number;
  };
  "checklist.task_settled": {
    taskId: string;
    employeeId: string;
    kind: string;
    status: string;
  };

  "offboarding.submitted": { requestId: string; employeeId: string };
  "offboarding.approved": { requestId: string; employeeId: string };
  "offboarding.confirmed": { requestId: string; employeeId: string; lastWorkingDay: string };
  "offboarding.cleared": { requestId: string; employeeId: string };
  "offboarding.settled": { requestId: string; employeeId: string };
  "offboarding.completed": { requestId: string; employeeId: string };
  "offboarding.cancelled": { requestId: string; employeeId: string };

  "performance.cycle_created": { cycleId: string; name: string };
  "performance.cycle_status_changed": {
    cycleId: string;
    from: string;
    to: string;
    opened: number;
  };
  "performance.goal_added": { goalId: string; cycleId: string; employeeId: string };
  "performance.goals_approved": { cycleId: string; employeeId: string; count: number };
  "performance.self_submitted": { reviewId: string; employeeId: string };
  "performance.manager_submitted": { reviewId: string; employeeId: string };
  "performance.final_rating_set": { reviewId: string; employeeId: string; rating: number | null };
  "performance.review_reopened": { reviewId: string; employeeId: string; to: string };

  "payroll.component_saved": { componentId: string; code: string };
  "payroll.salary_assigned": { salaryId: string; employeeId: string; effectiveFrom: string };
  "payroll.run_created": { runId: string; year: number; month: number };
  "payroll.run_approved": { runId: string; year: number; month: number; payslips: number };
  "payroll.run_paid": { runId: string };

  "document.category_saved": { categoryId: string; code: string };
  "document.uploaded": {
    documentId: string;
    employeeId: string | null;
    categoryId: string;
  };
  "document.downloaded": { documentId: string; employeeId: string | null };
  "document.updated": { documentId: string };
  "document.archived": { documentId: string };
  "announcement.changed": {
    announcementId: string;
    action: "drafted" | "published" | "deleted";
  };

  "employee.created": { employeeId: string; employeeCode: string; after: Record<string, unknown> };
  "employee.updated": {
    employeeId: string;
    changedFields: string[];
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
  "employee.status_changed": { employeeId: string; from: string; to: string };
  "employee.deleted": { employeeId: string };

  "org.location_changed": { locationId: string; action: "created" | "updated" | "deleted" };
  "org.department_changed": { departmentId: string; action: "created" | "updated" | "deleted" };
  "org.designation_changed": { designationId: string; action: "created" | "updated" | "deleted" };
  "org.company_updated": { changedFields: string[] };
  "org.setting_changed": { key: string };

  /// Shift rules and assignments both change what attendance computes, and
  /// therefore what someone is paid — so both are audited.
  "shift.changed": {
    shiftId: string;
    action: "created" | "updated" | "deleted";
    changedFields?: string[];
  };
  "shift.assigned": {
    employeeId: string;
    shiftId: string;
    effectiveFrom: string;
    previousShiftId: string | null;
  };

  /// Punches are the raw evidence behind a pay figure, so each one is audited
  /// alongside the work date it was filed under - which is not always the
  /// calendar date it happened on.
  "attendance.punched": {
    employeeId: string;
    punchId: string;
    direction: "in" | "out";
    workDate: string;
  };
  "attendance.correction_requested": {
    employeeId: string;
    correctionId: string;
    workDate: string;
  };
  /// Approving one rewrites what a day is worth, so who decided and what they
  /// decided both belong in the audit trail.
  "attendance.correction_reviewed": {
    employeeId: string;
    correctionId: string;
    workDate: string;
    decision: "approved" | "rejected";
  };
  "attendance.correction_cancelled": { employeeId: string; correctionId: string };
  /// HR entering a day on somebody's behalf. Rarer than a correction and
  /// harder to question afterwards, since nobody asked for it — so what was
  /// entered, and why, is recorded rather than merely the fact that it was.
  "attendance.manual_entry": {
    employeeId: string;
    correctionId: string;
    workDate: string;
    entered: { in: string | null; out: string | null; status: string | null };
    reason: string;
  };
  /// Freezing or reopening a month changes what payroll may pay out, so both
  /// directions are audited, with how many days moved.
  "attendance.month_locked": {
    year: number;
    month: number;
    action: "locked" | "reopened";
    records: number;
  };

  /// A target somebody will be measured against. Who set it, for whom, and
  /// how heavily it counts are all things people ask about afterwards.
  "task.created": {
    taskId: string;
    employeeId: string;
    origin: "assigned" | "self";
    title: string;
    weight: number;
    period: string;
  };
  "task.updated": {
    taskId: string;
    employeeId: string;
    from: { status: string; progress: number };
    to: { status: string; progress: number };
  };
  "task.deleted": {
    taskId: string;
    employeeId: string;
    origin: "assigned" | "self";
    title: string;
  };

  /// Hiring. Who we are looking for, and what happened to the people who
  /// applied — both questions get asked long after the fact.
  "recruitment.job_changed": {
    jobPostingId: string;
    title: string;
    action: string;
  };
  "recruitment.candidate_changed": {
    candidateId: string;
    email: string;
    action: "created" | "updated";
  };
  /// The funnel, as it actually moved. `from` is null on the first row,
  /// which is the application arriving.
  "recruitment.application_moved": {
    applicationId: string;
    jobTitle: string;
    from: string | null;
    to: string;
    reason: string | null;
  };
  "recruitment.interview_scheduled": {
    interviewId: string;
    applicationId: string;
    interviewerId: string;
    scheduledAt: string;
    roundName: string;
  };
  "recruitment.feedback_submitted": {
    interviewId: string;
    applicationId: string;
    rating: number;
    recommendation: string;
  };
  /// Money and approval both live here, so the row says what was offered and
  /// who let it go out.
  "recruitment.offer_changed": {
    offerId: string;
    applicationId: string;
    action: string;
    ctc: number | null;
  };
  /// The end of the pipeline: a candidate becomes somebody on the payroll.
  "recruitment.converted": {
    applicationId: string;
    offerId: string;
    employeeId: string;
    employeeCode: string;
    candidateEmail: string;
  };

  /// Taking data out of the system is itself a sensitive action, so the
  /// export is recorded alongside the rows it copied — who, how many, and
  /// under which filters.
  "audit.exported": {
    count: number;
    filters: Record<string, string | undefined>;
  };

  /// A holiday change moves what attendance and leave both cost, so the date
  /// is recorded alongside the id - that is the question asked afterwards.
  "holiday.changed": {
    holidayId: string;
    action: "created" | "updated" | "deleted";
    holidayDate: string;
  };

  "leave.type_changed": {
    leaveTypeId: string;
    action: "created" | "updated" | "deleted";
    changedFields?: string[];
  };
  /// A policy revision overwrites rather than versions, so the audit entry is
  /// the only record that the rules used to say something else.
  "leave.policy_changed": { leaveTypeId: string; action: "created" | "updated" };
  /// The reason is carried into the audit deliberately: an unexplained
  /// adjustment is indistinguishable from a mistake six months later.
  "leave.balance_adjusted": {
    employeeId: string;
    leaveTypeId: string;
    year: number;
    days: number;
    reason: string;
  };

  "leave.requested": {
    employeeId: string;
    requestId: string;
    leaveTypeId: string;
    startDate: string;
    endDate: string;
    days: number;
  };
  /// The balance moves on this decision, so the day count moves with it into
  /// the audit trail.
  "leave.reviewed": {
    employeeId: string;
    requestId: string;
    decision: "approved" | "rejected";
    days: number;
  };
  /// `restored` is zero unless the request had been approved - only an
  /// approved request had taken days out of the balance to put back.
  "leave.cancelled": { employeeId: string; requestId: string; restored: number };
}

export type DomainEventName = keyof DomainEventMap;

export interface DomainEvent<N extends DomainEventName = DomainEventName> {
  name: N;
  payload: DomainEventMap[N];
  actor: EventActor;
  at: Date;
}

type Subscriber = (event: DomainEvent) => void | Promise<void>;

/**
 * Anchored to the process rather than the module: subscribers registered from
 * one Next.js bundle must be visible to `emit()` called from another. See
 * ./global-store.ts.
 */
const subscribers = globalSingleton(
  "__hrms_event_subscribers__",
  () => new Map<DomainEventName | "*", Subscriber[]>(),
);

export function on<N extends DomainEventName>(
  name: N,
  handler: (event: DomainEvent<N>) => void | Promise<void>,
): void {
  const list = subscribers.get(name) ?? [];
  list.push(handler as Subscriber);
  subscribers.set(name, list);
}

/** Subscribe to every event — used by the audit writer. */
export function onAny(handler: Subscriber): void {
  const list = subscribers.get("*") ?? [];
  list.push(handler);
  subscribers.set("*", list);
}

export async function emit<N extends DomainEventName>(
  name: N,
  payload: DomainEventMap[N],
  actor: EventActor,
): Promise<void> {
  const event: DomainEvent<N> = { name, payload, actor, at: new Date() };
  const handlers = [...(subscribers.get(name) ?? []), ...(subscribers.get("*") ?? [])];

  const results = await Promise.allSettled(
    handlers.map((handler) => Promise.resolve(handler(event as DomainEvent))),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      logger.error(
        { err: result.reason, event: name, requestId: actor.requestId },
        "domain event subscriber failed",
      );
    }
  }
}

/** Test-only: drop every subscription. */
export function __resetSubscribers(): void {
  subscribers.clear();
}

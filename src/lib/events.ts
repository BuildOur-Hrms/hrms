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

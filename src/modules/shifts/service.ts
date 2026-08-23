import type { RequestContext } from "@/lib/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";
import { resolveScope } from "@/lib/permissions";

import {
  dateToTime,
  timeToDate,
  type AssignShiftInput,
  type CreateShiftInput,
  type UpdateShiftInput,
} from "./validators";

/**
 * Shifts and their assignment history.
 *
 * Two rules drive everything here:
 *
 *   1. Assignment history is append-and-close, never overwrite. Attendance for
 *      a past date has to be recomputable against the rules that were in force
 *      *on that date*. Editing an assignment in place would silently rewrite
 *      what someone was paid for.
 *   2. At most one shift is in force for an employee on any given date. The
 *      database enforces the open-ended half of that; this layer closes the
 *      previous range before opening the next so the two never both apply.
 */

function actor(ctx: RequestContext): EventActor {
  return {
    userId: ctx.userId,
    companyId: ctx.companyId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    db: ctx.db,
  };
}

const SHIFT_FIELDS = {
  id: true,
  name: true,
  code: true,
  startTime: true,
  endTime: true,
  graceMinutes: true,
  halfDayThresholdMinutes: true,
  breakMinutes: true,
  weekOffDays: true,
  isDefault: true,
} as const;

type ShiftRow = {
  startTime: Date;
  endTime: Date;
} & Record<string, unknown>;

/** Times reach the client as `HH:MM`; a serialised Date would carry a fake epoch date. */
function present<T extends ShiftRow>(shift: T) {
  return {
    ...shift,
    startTime: dateToTime(shift.startTime),
    endTime: dateToTime(shift.endTime),
  };
}

/** Midnight UTC for a `YYYY-MM-DD`, matching how `@db.Date` round-trips. */
function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function dayBefore(date: Date): Date {
  return new Date(date.getTime() - 86_400_000);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────── shifts

export async function listShifts(ctx: RequestContext) {
  const shifts = await ctx.db.shift.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: {
      ...SHIFT_FIELDS,
      // All assignments, not just open ones — this is what the delete guard
      // counts, and a UI that showed a smaller number would offer a delete
      // the server then refuses.
      _count: { select: { assignments: true } },
    },
  });
  return shifts.map(present);
}

export async function getShift(ctx: RequestContext, id: string) {
  const shift = await ctx.db.shift.findFirst({ where: { id }, select: SHIFT_FIELDS });
  if (!shift) throw new NotFoundError("Shift");
  return present(shift);
}

/**
 * Clearing the incumbent is not a nicety: `shifts_one_default_per_company` is
 * a partial unique index, so setting a second default without clearing the
 * first is a constraint violation, not a silent overwrite.
 */
async function clearExistingDefault(ctx: RequestContext, exceptId?: string) {
  await ctx.db.shift.updateMany({
    where: { isDefault: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    data: { isDefault: false },
  });
}

export async function createShift(ctx: RequestContext, input: CreateShiftInput) {
  if (input.isDefault) await clearExistingDefault(ctx);

  const shift = await ctx.db.shift.create({
    data: {
      companyId: ctx.companyId,
      name: input.name,
      code: input.code,
      startTime: timeToDate(input.startTime),
      endTime: timeToDate(input.endTime),
      graceMinutes: input.graceMinutes,
      halfDayThresholdMinutes: input.halfDayThresholdMinutes,
      breakMinutes: input.breakMinutes,
      weekOffDays: input.weekOffDays,
      isDefault: input.isDefault,
    },
    select: SHIFT_FIELDS,
  });

  await emit("shift.changed", { shiftId: shift.id, action: "created" }, actor(ctx));
  return present(shift);
}

export async function updateShift(ctx: RequestContext, id: string, input: UpdateShiftInput) {
  await mustExistShift(ctx, id);
  if (input.isDefault) await clearExistingDefault(ctx, id);

  const shift = await ctx.db.shift.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.startTime !== undefined ? { startTime: timeToDate(input.startTime) } : {}),
      ...(input.endTime !== undefined ? { endTime: timeToDate(input.endTime) } : {}),
      ...(input.graceMinutes !== undefined ? { graceMinutes: input.graceMinutes } : {}),
      ...(input.halfDayThresholdMinutes !== undefined
        ? { halfDayThresholdMinutes: input.halfDayThresholdMinutes }
        : {}),
      ...(input.breakMinutes !== undefined ? { breakMinutes: input.breakMinutes } : {}),
      ...(input.weekOffDays !== undefined ? { weekOffDays: input.weekOffDays } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
    },
    select: SHIFT_FIELDS,
  });

  // Editing a shift changes pay-relevant maths for everyone on it, so the
  // audit row says which fields moved rather than just "updated".
  await emit(
    "shift.changed",
    { shiftId: id, action: "updated", changedFields: Object.keys(input) },
    actor(ctx),
  );
  return present(shift);
}

export async function deleteShift(ctx: RequestContext, id: string) {
  const shift = await mustExistShift(ctx, id);

  if (shift.isDefault) {
    throw new ConflictError(
      "This is the default shift. Make another shift the default before removing it.",
    );
  }

  // Any assignment counts, not just open ones: a closed assignment is the
  // record of what a past month was calculated against.
  const assignments = await ctx.db.employeeShift.count({ where: { shiftId: id } });
  if (assignments > 0) {
    throw new ConflictError(
      `${assignments} assignment${assignments === 1 ? " references" : "s reference"} this shift, ` +
        `including past ones attendance was calculated against`,
    );
  }

  await ctx.db.shift.update({ where: { id }, data: { deletedAt: new Date() } });
  await emit("shift.changed", { shiftId: id, action: "deleted" }, actor(ctx));
}

async function mustExistShift(ctx: RequestContext, id: string) {
  const shift = await ctx.db.shift.findFirst({
    where: { id },
    select: { id: true, isDefault: true },
  });
  if (!shift) throw new NotFoundError("Shift");
  return shift;
}

// ─────────────────────────────────────────────── assignment

/**
 * Who may see whose shift history, reusing the employee module's scope rather
 * than inventing a second answer: own record always, direct reports with
 * `employee.view_team`, everyone with `employee.view_all`.
 *
 * Out of scope reads as absent rather than forbidden, so this cannot be used
 * to probe whether an employee id exists.
 */
async function assertCanViewEmployee(ctx: RequestContext, employeeId: string): Promise<void> {
  if (ctx.employeeId === employeeId) return;

  const scope = resolveScope(ctx, "employee");
  if (scope === "none") throw new ForbiddenError("You do not have access to employee records");

  const where =
    scope === "all"
      ? { id: employeeId }
      : { id: employeeId, managerId: ctx.employeeId ?? "00000000-0000-0000-0000-000000000000" };

  const visible = await ctx.db.employee.findFirst({ where, select: { id: true } });
  if (!visible) throw new NotFoundError("Employee");
}

export async function listAssignments(ctx: RequestContext, employeeId: string) {
  await assertCanViewEmployee(ctx, employeeId);

  const assignments = await ctx.db.employeeShift.findMany({
    where: { employeeId },
    orderBy: { effectiveFrom: "desc" },
    select: {
      id: true,
      effectiveFrom: true,
      effectiveTo: true,
      shift: { select: SHIFT_FIELDS },
    },
  });

  return assignments.map((a) => ({
    id: a.id,
    effectiveFrom: isoDate(a.effectiveFrom),
    effectiveTo: a.effectiveTo ? isoDate(a.effectiveTo) : null,
    shift: present(a.shift),
  }));
}

/**
 * Puts an employee on a shift from a date forward, closing whatever they were
 * on the day before.
 */
export async function assignShift(
  ctx: RequestContext,
  employeeId: string,
  input: AssignShiftInput,
) {
  const employee = await ctx.db.employee.findFirst({
    where: { id: employeeId },
    select: { id: true },
  });
  if (!employee) throw new NotFoundError("Employee");
  await mustExistShift(ctx, input.shiftId);

  const effectiveFrom = input.effectiveFrom ? toDateOnly(input.effectiveFrom) : today();

  const open = await ctx.db.employeeShift.findFirst({
    where: { employeeId, effectiveTo: null },
    select: { id: true, shiftId: true, effectiveFrom: true },
  });

  if (open) {
    if (open.shiftId === input.shiftId) {
      throw new ConflictError("This employee is already on that shift.");
    }

    // Closing the incumbent to the day before would put its end before its
    // start, which the range-ordered CHECK would reject — and backdating a
    // shift change over a period already calculated is not something to do
    // by accident.
    if (effectiveFrom <= open.effectiveFrom) {
      throw new ValidationError("Effective date must be after the current assignment started", {
        effectiveFrom: [
          `The current assignment starts ${isoDate(open.effectiveFrom)}. Choose a later date.`,
        ],
      });
    }

    await ctx.db.employeeShift.update({
      where: { id: open.id },
      data: { effectiveTo: dayBefore(effectiveFrom) },
    });
  }

  const created = await ctx.db.employeeShift.create({
    data: {
      companyId: ctx.companyId,
      employeeId,
      shiftId: input.shiftId,
      effectiveFrom,
    },
    select: { id: true, effectiveFrom: true, shift: { select: SHIFT_FIELDS } },
  });

  await emit(
    "shift.assigned",
    {
      employeeId,
      shiftId: input.shiftId,
      effectiveFrom: isoDate(effectiveFrom),
      previousShiftId: open?.shiftId ?? null,
    },
    actor(ctx),
  );

  return {
    id: created.id,
    effectiveFrom: isoDate(created.effectiveFrom),
    effectiveTo: null,
    shift: present(created.shift),
  };
}

/**
 * The shift in force for an employee on a date — what attendance calculation
 * will call once M2 lands. Falls back to the company default so a day can
 * still be evaluated for someone who was never explicitly assigned.
 */
export async function effectiveShift(
  ctx: Pick<RequestContext, "db">,
  employeeId: string,
  on: Date = today(),
) {
  const assignment = await ctx.db.employeeShift.findFirst({
    where: {
      employeeId,
      effectiveFrom: { lte: on },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
    },
    orderBy: { effectiveFrom: "desc" },
    select: { shift: { select: SHIFT_FIELDS } },
  });
  if (assignment) return present(assignment.shift);

  const fallback = await ctx.db.shift.findFirst({
    where: { isDefault: true },
    select: SHIFT_FIELDS,
  });
  return fallback ? present(fallback) : null;
}

/** Options for the assignment picker, alongside which shift is current. */
export async function shiftOptions(ctx: RequestContext, employeeId?: string) {
  if (employeeId) await assertCanViewEmployee(ctx, employeeId);

  const [shifts, current] = await Promise.all([
    ctx.db.shift.findMany({
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: SHIFT_FIELDS,
    }),
    employeeId ? effectiveShift(ctx, employeeId) : Promise.resolve(null),
  ]);

  return { shifts: shifts.map(present), current };
}

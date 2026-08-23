import type { RequestContext } from "@/lib/context";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";

import type { CreateHolidayInput, UpdateHolidayInput } from "./validators";

/**
 * The holiday calendar.
 *
 * Read by attendance calculation and by leave day-counting, so a change here
 * moves numbers on both. Deliberately not soft-deleted: a holiday that was
 * cancelled should stop applying, and keeping a tombstone that the day counter
 * has to remember to filter out is how a deleted holiday quietly keeps
 * costing people leave.
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

function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const HOLIDAY_FIELDS = {
  id: true,
  name: true,
  holidayDate: true,
  isOptional: true,
  locationId: true,
  location: { select: { id: true, name: true } },
} as const;

type HolidayRow = { holidayDate: Date } & Record<string, unknown>;

function present<T extends HolidayRow>(row: T) {
  return { ...row, holidayDate: isoDate(row.holidayDate) };
}

export async function listHolidays(ctx: RequestContext, year: number, locationId?: string) {
  const rows = await ctx.db.holiday.findMany({
    where: {
      holidayDate: {
        gte: new Date(Date.UTC(year, 0, 1)),
        lt: new Date(Date.UTC(year + 1, 0, 1)),
      },
      // A location's calendar is its own holidays plus the company-wide ones,
      // never only the location-specific ones.
      ...(locationId ? { OR: [{ locationId }, { locationId: null }] } : {}),
    },
    orderBy: { holidayDate: "asc" },
    select: HOLIDAY_FIELDS,
  });
  return rows.map(present);
}

/**
 * The dates that count as holidays for one employee, as `YYYY-MM-DD`.
 *
 * This is what the day counter and the attendance calculator consume. It
 * resolves the employee's location once and returns plain strings, so neither
 * of those has to know anything about the calendar's shape.
 */
export async function holidayDatesFor(
  ctx: Pick<RequestContext, "db">,
  employeeId: string,
  from: string,
  to: string,
): Promise<string[]> {
  const employee = await ctx.db.employee.findFirst({
    where: { id: employeeId },
    select: { locationId: true },
  });
  if (!employee) return [];

  const rows = await ctx.db.holiday.findMany({
    where: {
      holidayDate: { gte: toDateOnly(from), lte: toDateOnly(to) },
      OR: [{ locationId: employee.locationId }, { locationId: null }],
    },
    select: { holidayDate: true },
  });

  // A date listed both company-wide and for the location is one holiday.
  return [...new Set(rows.map((r) => isoDate(r.holidayDate)))];
}

export async function createHoliday(ctx: RequestContext, input: CreateHolidayInput) {
  if (input.locationId) {
    const location = await ctx.db.location.findFirst({
      where: { id: input.locationId },
      select: { id: true },
    });
    if (!location) throw new NotFoundError("Location");
  }

  const clash = await ctx.db.holiday.findFirst({
    where: {
      holidayDate: toDateOnly(input.holidayDate),
      locationId: input.locationId ?? null,
      name: input.name,
    },
    select: { id: true },
  });
  if (clash) throw new ConflictError("That holiday is already on the calendar.");

  const holiday = await ctx.db.holiday.create({
    data: {
      companyId: ctx.companyId,
      name: input.name,
      holidayDate: toDateOnly(input.holidayDate),
      locationId: input.locationId ?? null,
      isOptional: input.isOptional,
    },
    select: HOLIDAY_FIELDS,
  });

  await emit(
    "holiday.changed",
    { holidayId: holiday.id, action: "created", holidayDate: input.holidayDate },
    actor(ctx),
  );
  return present(holiday);
}

export async function updateHoliday(ctx: RequestContext, id: string, input: UpdateHolidayInput) {
  const existing = await ctx.db.holiday.findFirst({
    where: { id },
    select: { id: true, holidayDate: true },
  });
  if (!existing) throw new NotFoundError("Holiday");

  const holiday = await ctx.db.holiday.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.holidayDate !== undefined ? { holidayDate: toDateOnly(input.holidayDate) } : {}),
      ...(input.locationId !== undefined ? { locationId: input.locationId ?? null } : {}),
      ...(input.isOptional !== undefined ? { isOptional: input.isOptional } : {}),
    },
    select: HOLIDAY_FIELDS,
  });

  // Moving a holiday changes what past days cost. The audit says which one
  // moved and to where, because that is the question asked afterwards.
  await emit(
    "holiday.changed",
    {
      holidayId: id,
      action: "updated",
      holidayDate: input.holidayDate ?? isoDate(existing.holidayDate),
    },
    actor(ctx),
  );
  return present(holiday);
}

export async function deleteHoliday(ctx: RequestContext, id: string) {
  const existing = await ctx.db.holiday.findFirst({
    where: { id },
    select: { id: true, holidayDate: true },
  });
  if (!existing) throw new NotFoundError("Holiday");

  await ctx.db.holiday.delete({ where: { id } });
  await emit(
    "holiday.changed",
    { holidayId: id, action: "deleted", holidayDate: isoDate(existing.holidayDate) },
    actor(ctx),
  );
}

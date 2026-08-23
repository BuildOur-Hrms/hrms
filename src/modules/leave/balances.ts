import type { RequestContext } from "@/lib/context";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";
import { resolveScope } from "@/lib/permissions";

import { accrualFor, carryForwardAmount, currentBalance, round2 } from "./accrual";
import { policyFor } from "./types";
import type { AdjustBalanceInput } from "./validators";

/**
 * Leave balances: the running total, the accrual job, and HR adjustments.
 *
 * Every write goes through `ensureBalance` first, so a row always exists
 * before anything tries to add to it — an accrual that silently skipped
 * somebody because their row was missing is the kind of bug nobody notices
 * until they try to take leave in December.
 */

/** What the accrual and rollover jobs need: a database handle and a company. */
export type DataContext = Pick<RequestContext, "db" | "companyId">;

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

const BALANCE_FIELDS = {
  id: true,
  year: true,
  opening: true,
  accrued: true,
  used: true,
  carriedForward: true,
  adjusted: true,
  leaveType: { select: { id: true, name: true, code: true, color: true, isPaid: true } },
} as const;

type BalanceRow = {
  opening: unknown;
  accrued: unknown;
  used: unknown;
  carriedForward: unknown;
  adjusted: unknown;
} & Record<string, unknown>;

/**
 * Decimals become numbers, and `current` is computed here rather than stored.
 *
 * That is the whole reason there is no `current` column: the parts and the
 * total cannot disagree if only the parts are written.
 */
export function present<T extends BalanceRow>(row: T) {
  const parts = {
    opening: Number(row.opening),
    accrued: Number(row.accrued),
    used: Number(row.used),
    carriedForward: Number(row.carriedForward),
    adjusted: Number(row.adjusted),
  };
  return { ...row, ...parts, current: currentBalance(parts) };
}

/** The row for one employee, type and year, created empty if absent. */
export async function ensureBalance(
  ctx: DataContext,
  employeeId: string,
  leaveTypeId: string,
  year: number,
) {
  const existing = await ctx.db.leaveBalance.findFirst({
    where: { employeeId, leaveTypeId, year },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await ctx.db.leaveBalance.create({
    data: { companyId: ctx.companyId, employeeId, leaveTypeId, year },
    select: { id: true },
  });
  return created.id;
}

/**
 * Who may see whose balances, reusing the leave scope rather than inventing a
 * second answer. Out of scope reads as absent, not forbidden, so this cannot
 * be used to discover which employee ids exist.
 */
async function assertCanViewBalances(ctx: RequestContext, employeeId: string): Promise<void> {
  if (ctx.employeeId === employeeId) return;

  const scope = resolveScope(ctx, "leave");
  if (scope === "none" || scope === "own") {
    throw new ForbiddenError("You can only see your own leave");
  }

  const where =
    scope === "all"
      ? { id: employeeId }
      : { id: employeeId, managerId: ctx.employeeId ?? "00000000-0000-0000-0000-000000000000" };

  const visible = await ctx.db.employee.findFirst({ where, select: { id: true } });
  if (!visible) throw new NotFoundError("Employee");
}

/**
 * Every leave type with its balance for the year.
 *
 * Types with no balance row yet are included at zero rather than omitted: an
 * employee needs to see that a type exists before they can ask why it is
 * empty.
 */
export async function listBalances(ctx: RequestContext, year: number, employeeId?: string) {
  const target = employeeId ?? ctx.employeeId;
  if (!target) {
    throw new ConflictError("This account has no employee record, so it has no leave balances.");
  }
  await assertCanViewBalances(ctx, target);

  const [types, balances] = await Promise.all([
    ctx.db.leaveType.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, color: true, isPaid: true },
    }),
    ctx.db.leaveBalance.findMany({
      where: { employeeId: target, year },
      select: BALANCE_FIELDS,
    }),
  ]);

  const byType = new Map(balances.map((b) => [b.leaveType.id, present(b)]));

  return types.map(
    (leaveType) =>
      byType.get(leaveType.id) ?? {
        id: null,
        year,
        leaveType,
        opening: 0,
        accrued: 0,
        used: 0,
        carriedForward: 0,
        adjusted: 0,
        current: 0,
      },
  );
}

// ─────────────────────────────────────────────── accrual

export interface AccrualRunResult {
  year: number;
  month: number | null;
  credited: number;
  skipped: number;
}

/**
 * Credit accrual for one period across the company.
 *
 * Idempotent per period by construction: it sets `accrued` to the total the
 * policy says should have accrued by now, rather than adding to it. Running
 * the job twice in a month therefore credits once, which matters because a
 * retried cron is a normal event, not an exception.
 */
export async function runAccrual(
  ctx: DataContext,
  year: number,
  month: number | null,
  joinCutoffDay: number,
  log?: (message: string, detail: Record<string, unknown>) => void,
): Promise<AccrualRunResult> {
  const types = await ctx.db.leaveType.findMany({ select: { id: true } });
  const employees = await ctx.db.employee.findMany({
    where: {
      joinDate: { lte: new Date(Date.UTC(year, (month ?? 12) - 1, 28)) },
      OR: [{ exitDate: null }, { exitDate: { gte: new Date(Date.UTC(year, 0, 1)) } }],
    },
    select: { id: true, joinDate: true, exitDate: true },
  });

  let credited = 0;
  let skipped = 0;

  for (const type of types) {
    const policy = await policyFor(ctx, type.id);
    if (policy.accrualFrequency === "none") {
      skipped += employees.length;
      continue;
    }

    for (const employee of employees) {
      try {
        const joinDate = employee.joinDate.toISOString().slice(0, 10);
        const exitDate = employee.exitDate?.toISOString().slice(0, 10) ?? null;

        // The total earned so far this year, not this period's slice. That is
        // what makes a re-run credit the same number rather than double it.
        let total = 0;
        if (policy.accrualFrequency === "monthly") {
          for (let m = 1; m <= (month ?? 12); m++) {
            total += accrualFor({
              frequency: "monthly",
              amount: policy.accrualAmount,
              year,
              month: m,
              joinDate,
              exitDate,
              joinCutoffDay,
            });
          }
        } else {
          total = accrualFor({
            frequency: "yearly",
            amount: policy.accrualAmount,
            year,
            joinDate,
            exitDate,
            joinCutoffDay,
          });
        }

        const id = await ensureBalance(ctx, employee.id, type.id, year);
        await ctx.db.leaveBalance.update({ where: { id }, data: { accrued: round2(total) } });
        credited++;
      } catch (error) {
        skipped++;
        log?.("leave accrual failed for one employee", {
          employeeId: employee.id,
          leaveTypeId: type.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { year, month, credited, skipped };
}

/**
 * Roll unused days into the next year, capped by policy.
 *
 * Also idempotent: it writes the computed carry-forward rather than adding,
 * so a re-run lands on the same number.
 */
export async function runYearRollover(
  ctx: DataContext,
  fromYear: number,
  log?: (message: string, detail: Record<string, unknown>) => void,
): Promise<{ fromYear: number; carried: number }> {
  const balances = await ctx.db.leaveBalance.findMany({
    where: { year: fromYear },
    select: { ...BALANCE_FIELDS, employeeId: true },
  });

  let carried = 0;

  for (const balance of balances) {
    try {
      const policy = await policyFor(ctx, balance.leaveType.id);
      const closing = present(balance).current;
      const amount = carryForwardAmount(closing, policy.maxCarryForward);

      const id = await ensureBalance(ctx, balance.employeeId, balance.leaveType.id, fromYear + 1);
      await ctx.db.leaveBalance.update({ where: { id }, data: { carriedForward: amount } });
      carried++;
    } catch (error) {
      log?.("leave rollover failed for one balance", {
        balanceId: balance.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { fromYear, carried };
}

// ─────────────────────────────────────────────── adjustments

/**
 * A manual credit or debit by HR.
 *
 * Adds to `adjusted` rather than replacing it, so two corrections in a year
 * both stand. The reason is required and lands in the audit log — an
 * unexplained adjustment is indistinguishable from a mistake six months on.
 */
export async function adjustBalance(ctx: RequestContext, input: AdjustBalanceInput) {
  const employee = await ctx.db.employee.findFirst({
    where: { id: input.employeeId },
    select: { id: true },
  });
  if (!employee) throw new NotFoundError("Employee");

  const type = await ctx.db.leaveType.findFirst({
    where: { id: input.leaveTypeId },
    select: { id: true },
  });
  if (!type) throw new NotFoundError("Leave type");

  const id = await ensureBalance(ctx, input.employeeId, input.leaveTypeId, input.year);
  const before = await ctx.db.leaveBalance.findFirstOrThrow({
    where: { id },
    select: BALANCE_FIELDS,
  });

  const updated = await ctx.db.leaveBalance.update({
    where: { id },
    data: { adjusted: round2(Number(before.adjusted) + input.days) },
    select: BALANCE_FIELDS,
  });

  await emit(
    "leave.balance_adjusted",
    {
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      year: input.year,
      days: input.days,
      reason: input.reason,
    },
    actor(ctx),
  );

  return present(updated);
}

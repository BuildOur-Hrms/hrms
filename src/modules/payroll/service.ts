import { NOBODY, type RequestContext } from "@/lib/context";
import { csvCell } from "@/lib/csv";
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";
import { resolveScope } from "@/lib/permissions";
import { fromDateOnly } from "@/lib/utils";

import {
  computePayslip,
  daysInMonth,
  lopDaysFor,
  type AttendanceDay,
  type Component,
} from "./calculator";
import type {
  AssignSalaryInput,
  ComponentInput,
  CreateRunInput,
  ListPayslipsInput,
  ListRunsInput,
  RunStatusInput,
} from "./validators";

/**
 * Payroll, connected to the database.
 *
 * Two rules run through everything here.
 *
 * Salary is never team-visible. A manager can see their reports' attendance,
 * leave and goals, and none of their pay — so the scope machinery used
 * elsewhere is deliberately not used for payslips, which are either your own
 * or you hold `payroll.view_all`.
 *
 * A run reads a locked month. Payroll computed from attendance that can still
 * change is payroll that disagrees with itself a week later, so the lock is
 * required rather than recommended.
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

/**
 * BigInt is how money is stored; a plain number is how it travels.
 *
 * `JSON.stringify` throws on a BigInt rather than doing anything sensible
 * with it, so every one of these has to be converted before it leaves. Minor
 * units stay exact as a JavaScript number well past any salary anybody is
 * paid — the limit is around ninety trillion of them.
 */
function toNumber(value: bigint | number | { toString(): string }): number {
  return typeof value === "number" ? value : Number(value.toString());
}

function money(value: bigint | null): number | null {
  return value === null ? null : Number(value);
}

// ─────────────────────────────────────────────── components

export async function listComponents(ctx: RequestContext) {
  return ctx.db.salaryComponent.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      kind: true,
      calcType: true,
      prorates: true,
      sortOrder: true,
      baseComponent: { select: { id: true, code: true } },
    },
  });
}

export async function createComponent(ctx: RequestContext, input: ComponentInput) {
  const clash = await ctx.db.salaryComponent.findFirst({
    where: { code: input.code, deletedAt: null },
    select: { id: true },
  });
  if (clash) throw new ConflictError("A component with that code already exists");

  if (input.baseComponentId) {
    const base = await ctx.db.salaryComponent.findFirst({
      where: { id: input.baseComponentId, deletedAt: null },
      select: { id: true, calcType: true },
    });
    if (!base) throw new NotFoundError("Component");
    // A percentage of a percentage is a chain nobody can read off a payslip.
    if (base.calcType === "percentage") {
      throw new BusinessRuleError("A percentage can only be taken of a fixed component.", {
        rule: "percentage_of_percentage",
      });
    }
  }

  const component = await ctx.db.salaryComponent.create({
    data: {
      companyId: ctx.companyId,
      code: input.code,
      name: input.name,
      kind: input.kind,
      calcType: input.calcType,
      baseComponentId: input.baseComponentId ?? null,
      prorates: input.prorates,
      sortOrder: input.sortOrder,
    },
    select: { id: true, code: true, name: true },
  });

  await emit(
    "payroll.component_saved",
    { componentId: component.id, code: component.code },
    actor(ctx),
  );
  return component;
}

export async function deleteComponent(ctx: RequestContext, id: string) {
  const component = await ctx.db.salaryComponent.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!component) throw new NotFoundError("Component");

  // Archived, never erased: payslips name their components, and a payslip
  // that cannot say what it paid is not a payslip.
  await ctx.db.salaryComponent.update({ where: { id }, data: { deletedAt: new Date() } });
  return { id };
}

// ─────────────────────────────────────────────── salaries

/**
 * What somebody is paid, and what they were paid before.
 *
 * The whole history, because "why was March different" is the question this
 * table exists to answer.
 */
export async function salaryHistory(ctx: RequestContext, employeeId: string) {
  if (resolveScope(ctx, "payroll") !== "all" && employeeId !== ctx.employeeId) {
    throw new NotFoundError("Employee");
  }

  const rows = await ctx.db.employeeSalary.findMany({
    where: { employeeId },
    orderBy: { effectiveFrom: "desc" },
    select: {
      id: true,
      effectiveFrom: true,
      effectiveTo: true,
      note: true,
      items: {
        select: {
          id: true,
          amountMinor: true,
          percent: true,
          component: {
            select: { id: true, code: true, name: true, kind: true, calcType: true },
          },
        },
      },
    },
  });

  return rows.map((row) => ({
    ...row,
    items: row.items.map((item) => ({
      ...item,
      amountMinor: money(item.amountMinor),
      percent: item.percent === null ? null : toNumber(item.percent),
    })),
  }));
}

/**
 * Give somebody a salary, from a date.
 *
 * The revision in force is closed the day before this one starts rather than
 * edited, so every payslip ever produced can still be explained by the row
 * that was current when it ran.
 */
export async function assignSalary(
  ctx: RequestContext,
  employeeId: string,
  input: AssignSalaryInput,
) {
  const employee = await ctx.db.employee.findFirst({
    where: { id: employeeId },
    select: { id: true },
  });
  if (!employee) throw new NotFoundError("Employee");

  const from = fromDateOnly(input.effectiveFrom);

  const current = await ctx.db.employeeSalary.findFirst({
    where: { employeeId, effectiveTo: null },
    select: { id: true, effectiveFrom: true },
  });

  if (current && current.effectiveFrom >= from) {
    throw new BusinessRuleError(
      "A revision must start after the one it replaces. Backdating means editing history.",
      { rule: "revision_not_later" },
    );
  }

  if (current) {
    const dayBefore = new Date(from);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    await ctx.db.employeeSalary.update({
      where: { id: current.id },
      data: { effectiveTo: dayBefore },
    });
  }

  const salary = await ctx.db.employeeSalary.create({
    data: {
      companyId: ctx.companyId,
      employeeId,
      effectiveFrom: from,
      note: input.note ?? null,
      createdBy: ctx.userId,
      items: {
        create: input.items.map((item) => ({
          companyId: ctx.companyId,
          componentId: item.componentId,
          amountMinor: item.amountMinor == null ? null : BigInt(item.amountMinor),
          percent: item.percent == null ? null : item.percent,
        })),
      },
    },
    select: { id: true, effectiveFrom: true },
  });

  await emit(
    "payroll.salary_assigned",
    { salaryId: salary.id, employeeId, effectiveFrom: input.effectiveFrom },
    actor(ctx),
  );
  return salary;
}

// ─────────────────────────────────────────────── runs

export async function listRuns(ctx: RequestContext, input: ListRunsInput) {
  return ctx.db.payrollRun.findMany({
    where: {
      ...(input.year ? { year: input.year } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: {
      id: true,
      year: true,
      month: true,
      status: true,
      note: true,
      approvedAt: true,
      paidAt: true,
      _count: { select: { payslips: true } },
    },
  });
}

/**
 * Everything needed to work out one month, read in three queries.
 *
 * Per-employee reads would be one query each for salary, attendance and
 * leave — a hundred people is three hundred round trips for a screen
 * somebody expects to load.
 */
async function gatherMonth(ctx: RequestContext, year: number, month: number) {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 0));

  const employees = await ctx.db.employee.findMany({
    where: { status: { in: ["active", "on_notice"] }, deletedAt: null },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: { id: true, firstName: true, lastName: true, employeeCode: true },
  });
  if (employees.length === 0) return { employees, salaries: [], attendance: [], unpaid: [] };

  const ids = employees.map((employee) => employee.id);

  const salaries = await ctx.db.employeeSalary.findMany({
    where: {
      employeeId: { in: ids },
      effectiveFrom: { lte: periodEnd },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }],
    },
    orderBy: { effectiveFrom: "desc" },
    select: {
      employeeId: true,
      effectiveFrom: true,
      items: {
        select: {
          amountMinor: true,
          percent: true,
          component: {
            select: {
              id: true,
              code: true,
              name: true,
              kind: true,
              calcType: true,
              prorates: true,
              sortOrder: true,
              baseComponent: { select: { code: true } },
            },
          },
        },
      },
    },
  });

  const attendance = await ctx.db.attendanceRecord.findMany({
    where: { employeeId: { in: ids }, workDate: { gte: periodStart, lte: periodEnd } },
    select: { employeeId: true, status: true, workDate: true },
  });

  /*
   * Which days off were unpaid.
   *
   * An attendance record says somebody was on leave; it does not say on what
   * kind, because attendance does not care. Payroll does — unpaid leave is
   * the whole reason this module reads leave at all — so the approved
   * requests are fetched and the dates they cover are marked.
   */
  const unpaid = await ctx.db.leaveRequest.findMany({
    where: {
      employeeId: { in: ids },
      status: "approved",
      leaveType: { isPaid: false },
      startDate: { lte: periodEnd },
      endDate: { gte: periodStart },
    },
    select: { employeeId: true, startDate: true, endDate: true },
  });

  return { employees, salaries, attendance, unpaid };
}

type GatheredSalary = Awaited<ReturnType<typeof gatherMonth>>["salaries"][number];

function componentsFrom(salary: GatheredSalary): Component[] {
  return salary.items.map((item) => ({
    code: item.component.code,
    name: item.component.name,
    kind: item.component.kind,
    prorates: item.component.prorates,
    sortOrder: item.component.sortOrder,
    amountMinor: item.amountMinor == null ? null : toNumber(item.amountMinor),
    percentOf:
      item.component.calcType === "percentage" && item.component.baseComponent
        ? {
            code: item.component.baseComponent.code,
            percent: item.percent == null ? 0 : toNumber(item.percent),
          }
        : null,
  }));
}

/**
 * Work out a month without saving anything.
 *
 * The same code path the run uses, so what HR reviews is what gets approved
 * rather than a preview that happens to agree most of the time.
 */
export async function previewMonth(ctx: RequestContext, year: number, month: number) {
  const { employees, salaries, attendance, unpaid } = await gatherMonth(ctx, year, month);
  const periodDays = daysInMonth(year, month);

  const salaryFor = new Map<string, GatheredSalary>();
  for (const salary of salaries) {
    // Ordered newest first, so the first one seen is the one in force.
    if (!salaryFor.has(salary.employeeId)) salaryFor.set(salary.employeeId, salary);
  }

  // `employeeId|YYYY-MM-DD` for every day covered by unpaid leave.
  const unpaidDays = new Set<string>();
  for (const request of unpaid) {
    const day = new Date(request.startDate);
    while (day <= request.endDate) {
      unpaidDays.add(`${request.employeeId}|${day.toISOString().slice(0, 10)}`);
      day.setUTCDate(day.getUTCDate() + 1);
    }
  }

  const daysFor = new Map<string, AttendanceDay[]>();
  for (const record of attendance) {
    const list = daysFor.get(record.employeeId) ?? [];
    const key = `${record.employeeId}|${record.workDate.toISOString().slice(0, 10)}`;
    list.push({ status: record.status, unpaidLeave: unpaidDays.has(key) });
    daysFor.set(record.employeeId, list);
  }

  return employees.map((employee) => {
    const salary = salaryFor.get(employee.id);
    const lopDays = lopDaysFor(daysFor.get(employee.id) ?? []);

    return {
      employee,
      // Somebody with no salary on record is listed with nothing rather than
      // left out. A missing person is how a payroll quietly underpays.
      hasSalary: salary !== undefined,
      ...computePayslip({
        components: salary ? componentsFrom(salary) : [],
        periodDays,
        lopDays,
      }),
    };
  });
}

/**
 * Open a month's payroll.
 *
 * Refused unless attendance for that month is locked. Everything downstream
 * — the days, the loss of pay, the net — is read from records that a
 * correction could still move, and a payslip that changes after it was issued
 * is worse than one that was late.
 */
export async function createRun(ctx: RequestContext, input: CreateRunInput) {
  const lock = await ctx.db.attendanceMonthLock.findFirst({
    where: { year: input.year, month: input.month },
    select: { id: true },
  });
  if (!lock) {
    throw new BusinessRuleError(
      "Lock attendance for this month before running payroll — otherwise a correction can move the numbers underneath it.",
      { rule: "month_not_locked", year: input.year, month: input.month },
    );
  }

  const existing = await ctx.db.payrollRun.findFirst({
    where: { year: input.year, month: input.month },
    select: { id: true },
  });
  if (existing) throw new ConflictError("There is already a run for that month");

  const run = await ctx.db.payrollRun.create({
    data: {
      companyId: ctx.companyId,
      year: input.year,
      month: input.month,
      note: input.note ?? null,
    },
    select: { id: true, year: true, month: true, status: true },
  });

  await emit(
    "payroll.run_created",
    { runId: run.id, year: run.year, month: run.month },
    actor(ctx),
  );
  return run;
}

/**
 * Approve a run, which is what turns a calculation into payslips.
 *
 * The payslips are written here and never recomputed. From this moment the
 * figures are a record of what was decided, not a view over data that has
 * moved on.
 */
export async function approveRun(ctx: RequestContext, id: string) {
  const run = await ctx.db.payrollRun.findFirst({
    where: { id },
    select: { id: true, year: true, month: true, status: true },
  });
  if (!run) throw new NotFoundError("Run");

  if (run.status !== "draft") {
    throw new BusinessRuleError("This run has already been approved.", {
      rule: "already_approved",
    });
  }

  const rows = await previewMonth(ctx, run.year, run.month);
  const payable = rows.filter((row) => row.hasSalary);

  if (payable.length === 0) {
    throw new BusinessRuleError("Nobody in this run has a salary on record.", {
      rule: "nothing_to_pay",
    });
  }

  /*
   * Two writes, not two per person.
   *
   * This used to be a `create` per payslip with its lines nested inside, so
   * approving a month for five hundred people was a thousand round trips
   * taken one at a time — all of them inside the request's transaction, and
   * so all of them holding one of the very few pooled connections a
   * serverless function gets. Approving payroll is by definition the moment
   * there are the most rows to write, which is the worst moment to be doing
   * it a row at a time.
   *
   * `createManyAndReturn` gives back the generated ids in the order the rows
   * were supplied, which is what lets the lines be written in one go after.
   */
  const payslips = await ctx.db.payslip.createManyAndReturn({
    data: payable.map((row) => ({
      companyId: ctx.companyId,
      runId: id,
      employeeId: row.employee.id,
      periodDays: row.periodDays,
      lopDays: row.lopDays,
      payableDays: row.payableDays,
      grossMinor: BigInt(row.grossMinor),
      deductionsMinor: BigInt(row.deductionsMinor),
      netMinor: BigInt(row.netMinor),
    })),
    select: { id: true, employeeId: true },
  });

  // Matched by employee rather than by position: relying on the order rows
  // come back in is the kind of assumption that holds until it does not, and
  // this is somebody's pay.
  const payslipIdByEmployee = new Map(payslips.map((p) => [p.employeeId, p.id]));

  await ctx.db.payslipItem.createMany({
    data: payable.flatMap((row) => {
      const payslipId = payslipIdByEmployee.get(row.employee.id);
      if (!payslipId) return [];
      return row.lines.map((line) => ({
        companyId: ctx.companyId,
        payslipId,
        code: line.code,
        name: line.name,
        kind: line.kind,
        amountMinor: BigInt(line.amountMinor),
        sortOrder: line.sortOrder,
      }));
    }),
  });

  await ctx.db.payrollRun.update({
    where: { id },
    data: { status: "approved", approvedBy: ctx.userId, approvedAt: new Date() },
  });

  await emit(
    "payroll.run_approved",
    { runId: id, year: run.year, month: run.month, payslips: payable.length },
    actor(ctx),
  );

  return { id, status: "approved", payslips: payable.length };
}

/** Mark a run paid, once the finance system has actually paid it. */
export async function markRunPaid(ctx: RequestContext, id: string, input: RunStatusInput) {
  const run = await ctx.db.payrollRun.findFirst({
    where: { id },
    select: { id: true, status: true },
  });
  if (!run) throw new NotFoundError("Run");

  if (input.status !== "paid" || run.status !== "approved") {
    throw new BusinessRuleError("Only an approved run can be marked paid.", {
      rule: "invalid_run_transition",
      from: run.status,
      to: input.status,
    });
  }

  await ctx.db.payrollRun.update({ where: { id }, data: { status: "paid", paidAt: new Date() } });
  await emit("payroll.run_paid", { runId: id }, actor(ctx));
  return { id, status: "paid" };
}

// ─────────────────────────────────────────────── payslips

/**
 * Payslips, and who may read them.
 *
 * No team scope on purpose: a manager sees their reports' attendance and
 * their goals, and never their pay.
 */
export async function listPayslips(ctx: RequestContext, input: ListPayslipsInput) {
  const canSeeAll = resolveScope(ctx, "payroll") === "all";
  const me = ctx.employeeId ?? NOBODY;

  const where: Record<string, unknown> = {
    ...(input.runId ? { runId: input.runId } : {}),
  };

  if (input.mine || !canSeeAll) {
    where["employeeId"] = me;
  } else if (input.employeeId) {
    where["employeeId"] = input.employeeId;
  }

  const rows = await ctx.db.payslip.findMany({
    where,
    orderBy: [{ run: { year: "desc" } }, { run: { month: "desc" } }],
    take: 500,
    select: {
      id: true,
      periodDays: true,
      lopDays: true,
      payableDays: true,
      grossMinor: true,
      deductionsMinor: true,
      netMinor: true,
      run: { select: { id: true, year: true, month: true, status: true } },
      employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
    },
  });

  return rows.map((row) => ({
    ...row,
    periodDays: toNumber(row.periodDays),
    lopDays: toNumber(row.lopDays),
    payableDays: toNumber(row.payableDays),
    grossMinor: Number(row.grossMinor),
    deductionsMinor: Number(row.deductionsMinor),
    netMinor: Number(row.netMinor),
  }));
}

export async function getPayslip(ctx: RequestContext, id: string) {
  const payslip = await ctx.db.payslip.findFirst({
    where: { id },
    select: {
      id: true,
      employeeId: true,
      periodDays: true,
      lopDays: true,
      payableDays: true,
      grossMinor: true,
      deductionsMinor: true,
      netMinor: true,
      run: { select: { id: true, year: true, month: true, status: true } },
      employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
      items: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, code: true, name: true, kind: true, amountMinor: true },
      },
    },
  });
  if (!payslip) throw new NotFoundError("Payslip");

  const canSeeAll = resolveScope(ctx, "payroll") === "all";
  if (!canSeeAll && payslip.employeeId !== ctx.employeeId) throw new NotFoundError("Payslip");

  return {
    ...payslip,
    periodDays: toNumber(payslip.periodDays),
    lopDays: toNumber(payslip.lopDays),
    payableDays: toNumber(payslip.payableDays),
    grossMinor: Number(payslip.grossMinor),
    deductionsMinor: Number(payslip.deductionsMinor),
    netMinor: Number(payslip.netMinor),
    items: payslip.items.map((item) => ({ ...item, amountMinor: Number(item.amountMinor) })),
  };
}

/**
 * The handoff to whatever pays people.
 *
 * One row per person with the totals, because that is what a finance system
 * imports: it does not care which allowance made up the gross, only what to
 * transfer. The component breakdown stays here, on the payslip, where the
 * person it concerns can read it.
 */
export async function exportRun(ctx: RequestContext, id: string): Promise<string> {
  if (resolveScope(ctx, "payroll") !== "all") throw new ForbiddenError("payroll.view_all");

  const run = await ctx.db.payrollRun.findFirst({
    where: { id },
    select: { id: true, year: true, month: true, status: true },
  });
  if (!run) throw new NotFoundError("Run");

  if (run.status === "draft") {
    throw new BusinessRuleError("Approve the run before exporting it.", { rule: "run_is_draft" });
  }

  const payslips = await ctx.db.payslip.findMany({
    where: { runId: id },
    orderBy: { employee: { employeeCode: "asc" } },
    select: {
      lopDays: true,
      payableDays: true,
      grossMinor: true,
      deductionsMinor: true,
      netMinor: true,
      employee: { select: { employeeCode: true, firstName: true, lastName: true } },
    },
  });

  const header = [
    "employee_code",
    "name",
    "period",
    "payable_days",
    "lop_days",
    "gross_minor",
    "deductions_minor",
    "net_minor",
  ];

  const period = `${run.year}-${String(run.month).padStart(2, "0")}`;
  const lines = [header.join(",")];

  for (const payslip of payslips) {
    lines.push(
      [
        csvCell(payslip.employee.employeeCode),
        csvCell([payslip.employee.firstName, payslip.employee.lastName].filter(Boolean).join(" ")),
        csvCell(period),
        csvCell(payslip.payableDays.toString()),
        csvCell(payslip.lopDays.toString()),
        // Minor units, so whatever reads this never has to parse a decimal
        // point that might be a comma somewhere else in the world.
        csvCell(payslip.grossMinor.toString()),
        csvCell(payslip.deductionsMinor.toString()),
        csvCell(payslip.netMinor.toString()),
      ].join(","),
    );
  }

  return lines.join("\r\n");
}

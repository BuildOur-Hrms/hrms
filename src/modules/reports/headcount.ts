import {
  employeeScopeWhere,
  fullName,
  humanize,
  isoDate,
  type ReportResult,
  type RunnerArgs,
} from "./runner";

/**
 * R1 — Headcount: who is on the books right now.
 *
 * Exited people are left out unless you ask for them by status. "Current
 * workforce composition" is the question this report answers, and a leaver
 * from two years ago is not part of it — but the row is still reachable,
 * because "who left" is a real question too (R11 answers it properly in
 * Phase 2).
 */
export async function headcount({ ctx, scope, query }: RunnerArgs): Promise<ReportResult> {
  const where: Record<string, unknown> = {
    ...employeeScopeWhere(ctx, scope),
    ...(query.status ? { status: query.status } : { status: { not: "exited" } }),
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.locationId ? { locationId: query.locationId } : {}),
    ...(query.employmentType ? { employmentType: query.employmentType } : {}),
  };

  const [employees, total, byStatus] = await Promise.all([
    ctx.db.employee.findMany({
      where,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        employmentType: true,
        status: true,
        joinDate: true,
        department: { select: { name: true } },
        designation: { select: { title: true } },
        location: { select: { name: true } },
      },
    }),
    ctx.db.employee.count({ where }),
    ctx.db.employee.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);

  return {
    rows: employees.map((e) => ({
      id: e.id,
      employee: fullName(e),
      employeeCode: e.employeeCode,
      department: e.department?.name ?? null,
      designation: e.designation?.title ?? null,
      location: e.location?.name ?? null,
      employmentType: humanize(e.employmentType),
      status: humanize(e.status),
      joinDate: isoDate(e.joinDate),
    })),
    total,
    kpis: [
      { label: "Headcount", value: total },
      ...byStatus
        .slice()
        .sort((a, b) => b._count._all - a._count._all)
        .map((row) => ({ label: humanize(row.status), value: row._count._all })),
    ],
    breakdown: query.groupBy ? await groupCounts(ctx, where, query.groupBy) : undefined,
  };
}

type GroupBy = NonNullable<RunnerArgs["query"]["groupBy"]>;

/**
 * Counts per group, from the database rather than from the current page —
 * grouping a paginated list in the browser would describe fifty people and
 * label it the company.
 */
async function groupCounts(
  ctx: RunnerArgs["ctx"],
  where: Record<string, unknown>,
  groupBy: GroupBy,
): Promise<{ label: string; count: number }[]> {
  if (groupBy === "status" || groupBy === "employmentType") {
    const rows = await ctx.db.employee.groupBy({
      by: [groupBy],
      where,
      _count: { _all: true },
    });
    return rows
      .map((row) => ({ label: humanize(String(row[groupBy])), count: row._count._all }))
      .sort((a, b) => b.count - a.count);
  }

  const field = groupBy === "department" ? "departmentId" : "locationId";
  const rows = await ctx.db.employee.groupBy({ by: [field], where, _count: { _all: true } });

  const ids = rows.map((row) => String(row[field])).filter(Boolean);
  const named =
    groupBy === "department"
      ? await ctx.db.department.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : await ctx.db.location.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        });
  const names = new Map(named.map((n) => [n.id, n.name]));

  return rows
    .map((row) => ({
      label: names.get(String(row[field])) ?? "Unassigned",
      count: row._count._all,
    }))
    .sort((a, b) => b.count - a.count);
}

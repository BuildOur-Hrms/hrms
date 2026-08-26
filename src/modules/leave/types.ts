import type { RequestContext } from "@/lib/context";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";

import type { CreateLeaveTypeInput, UpdateLeaveTypeInput, UpsertPolicyInput } from "./validators";

/**
 * Leave types and the one policy each of them carries.
 *
 * A policy revision overwrites rather than versions. Days already accrued
 * under the old rules are a number, not a rule — they stay correct without the
 * old policy being kept around — and the change is audited with what moved.
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

const POLICY_FIELDS = {
  id: true,
  accrualFrequency: true,
  accrualAmount: true,
  maxCarryForward: true,
  maxNegative: true,
  minNoticeDays: true,
  maxConsecutiveDays: true,
  applicableAfterProbation: true,
  sandwichRule: true,
} as const;

const TYPE_FIELDS = {
  id: true,
  name: true,
  code: true,
  isPaid: true,
  color: true,
  requiresAttachment: true,
  policy: { select: POLICY_FIELDS },
} as const;

/**
 * Decimals reach the client as numbers.
 *
 * Prisma returns `Decimal` objects, which serialise to something a form cannot
 * put in a number input. Converting once here means no screen has to know the
 * column type.
 */
function presentPolicy(
  policy: {
    accrualAmount: unknown;
    maxCarryForward: unknown;
    maxNegative: unknown;
  } & Record<string, unknown>,
) {
  return {
    ...policy,
    accrualAmount: Number(policy.accrualAmount),
    maxCarryForward: Number(policy.maxCarryForward),
    maxNegative: Number(policy.maxNegative),
  };
}

type TypeRow = { policy: Record<string, unknown> | null } & Record<string, unknown>;

function present<T extends TypeRow>(row: T) {
  return { ...row, policy: row.policy ? presentPolicy(row.policy as never) : null };
}

export async function listLeaveTypes(ctx: RequestContext) {
  const rows = await ctx.db.leaveType.findMany({
    // Archived types are gone from every list, including the apply form.
    // Deleting one sets `deleted_at` and nothing was reading it, so a type
    // somebody had retired stayed on offer to every employee.
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    select: {
      ...TYPE_FIELDS,
      _count: { select: { requests: true } },
    },
  });
  return rows.map(present);
}

export async function createLeaveType(ctx: RequestContext, input: CreateLeaveTypeInput) {
  const clash = await ctx.db.leaveType.findFirst({
    where: { code: input.code },
    select: { id: true },
  });
  if (clash) throw new ConflictError(`A leave type with code ${input.code} already exists.`);

  const type = await ctx.db.leaveType.create({
    data: {
      companyId: ctx.companyId,
      name: input.name,
      code: input.code,
      isPaid: input.isPaid,
      color: input.color ?? null,
      requiresAttachment: input.requiresAttachment,
    },
    select: TYPE_FIELDS,
  });

  await emit("leave.type_changed", { leaveTypeId: type.id, action: "created" }, actor(ctx));
  return present(type);
}

export async function updateLeaveType(
  ctx: RequestContext,
  id: string,
  input: UpdateLeaveTypeInput,
) {
  await mustExistType(ctx, id);

  const type = await ctx.db.leaveType.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.isPaid !== undefined ? { isPaid: input.isPaid } : {}),
      ...(input.color !== undefined ? { color: input.color ?? null } : {}),
      ...(input.requiresAttachment !== undefined
        ? { requiresAttachment: input.requiresAttachment }
        : {}),
    },
    select: TYPE_FIELDS,
  });

  await emit(
    "leave.type_changed",
    { leaveTypeId: id, action: "updated", changedFields: Object.keys(input) },
    actor(ctx),
  );
  return present(type);
}

export async function deleteLeaveType(ctx: RequestContext, id: string) {
  await mustExistType(ctx, id);

  // Any request counts, not just open ones: a closed request is the record of
  // what a past year's balance was spent on.
  const requests = await ctx.db.leaveRequest.count({ where: { leaveTypeId: id } });
  if (requests > 0) {
    throw new ConflictError(
      `${requests} request${requests === 1 ? " uses" : "s use"} this type, including past ones`,
    );
  }

  const balances = await ctx.db.leaveBalance.count({ where: { leaveTypeId: id } });
  if (balances > 0) {
    throw new ConflictError(
      `${balances} balance${balances === 1 ? "" : "s"} still exist for this type`,
    );
  }

  await ctx.db.leaveType.update({ where: { id }, data: { deletedAt: new Date() } });
  await emit("leave.type_changed", { leaveTypeId: id, action: "deleted" }, actor(ctx));
}

async function mustExistType(ctx: RequestContext, id: string) {
  const type = await ctx.db.leaveType.findFirst({ where: { id }, select: { id: true } });
  if (!type) throw new NotFoundError("Leave type");
  return type;
}

/**
 * Set or replace the policy for a type.
 *
 * One policy per type, enforced by a unique column — so this is an upsert
 * rather than a create, and a second call revises rather than conflicting.
 */
export async function upsertPolicy(
  ctx: RequestContext,
  leaveTypeId: string,
  input: UpsertPolicyInput,
) {
  await mustExistType(ctx, leaveTypeId);

  const before = await ctx.db.leavePolicy.findFirst({
    where: { leaveTypeId },
    select: POLICY_FIELDS,
  });

  const data = {
    accrualFrequency: input.accrualFrequency,
    accrualAmount: input.accrualAmount,
    maxCarryForward: input.maxCarryForward,
    maxNegative: input.maxNegative,
    minNoticeDays: input.minNoticeDays,
    maxConsecutiveDays: input.maxConsecutiveDays ?? null,
    applicableAfterProbation: input.applicableAfterProbation,
    sandwichRule: input.sandwichRule,
  };

  const policy = await ctx.db.leavePolicy.upsert({
    where: { leaveTypeId },
    create: { companyId: ctx.companyId, leaveTypeId, ...data },
    update: data,
    select: POLICY_FIELDS,
  });

  await emit(
    "leave.policy_changed",
    { leaveTypeId, action: before ? "updated" : "created" },
    actor(ctx),
  );
  return presentPolicy(policy);
}

/**
 * The policy in force for a type, with the defaults a missing one implies.
 *
 * A type with no policy is usable — it simply accrues nothing and allows no
 * negative balance, which is the safe reading rather than an error that would
 * block someone applying for unpaid leave.
 */
export async function policyFor(ctx: Pick<RequestContext, "db">, leaveTypeId: string) {
  const policy = await ctx.db.leavePolicy.findFirst({
    where: { leaveTypeId },
    select: POLICY_FIELDS,
  });

  return {
    accrualFrequency: policy?.accrualFrequency ?? ("none" as const),
    accrualAmount: Number(policy?.accrualAmount ?? 0),
    maxCarryForward: Number(policy?.maxCarryForward ?? 0),
    maxNegative: Number(policy?.maxNegative ?? 0),
    minNoticeDays: policy?.minNoticeDays ?? 0,
    maxConsecutiveDays: policy?.maxConsecutiveDays ?? null,
    applicableAfterProbation: policy?.applicableAfterProbation ?? false,
    sandwichRule: policy?.sandwichRule ?? false,
  };
}

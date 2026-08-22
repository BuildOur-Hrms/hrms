import type { RequestContext } from "@/lib/context";
import { withPlatform, type TenantTx } from "@/lib/db";
import { env } from "@/lib/env";
import { AuthError, BusinessRuleError, ValidationError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";
import { enqueue } from "@/lib/queue";
import { renderEmailShell, escapeHtml } from "@/lib/email";
import { createSessionToken } from "@/lib/session";
import type { PermissionCode } from "@/lib/permissions";
import { getSettings } from "@/modules/settings/service";

import { checkPasswordPolicy, dummyHash, hashPassword, verifyPassword } from "./password";
import { buildInviteUrl, buildResetUrl, hashToken, issueToken } from "./tokens";
import type { ForgotPasswordInput, LoginInput, ResetPasswordInput } from "./validators";

/**
 * Authentication (docs/05-architecture.md §4, docs/09-security.md §2).
 *
 * Everything in here runs before a tenant is known — the login form has no
 * company context — so these functions use `withPlatform` rather than a
 * tenant-scoped client. Each one is deliberately narrow: look up exactly one
 * user by exactly one identifier, and never return rows to a caller.
 */

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

/**
 * `db` is passed wherever the emit happens inside a transaction. It does two
 * things: the audit row commits atomically with the change it describes, and —
 * just as importantly — the audit writer reuses this connection instead of
 * asking the pool for a second one. Opening an independent transaction from
 * inside one is a self-deadlock: the outer holds a connection while waiting
 * for the inner, which is waiting for the outer to release it.
 */
function actorFor(
  meta: RequestMeta,
  companyId: string,
  userId: string | null,
  db?: TenantTx,
): EventActor {
  return {
    userId,
    companyId,
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
    ...(db ? { db } : {}),
  };
}

// ─────────────────────────────────────────────── login

export interface LoginResult {
  token: string;
  user: {
    id: string;
    email: string;
    companyId: string;
    employeeId: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  roles: string[];
  permissions: PermissionCode[];
}

/**
 * Verify credentials and mint a session.
 *
 * Failure modes are deliberately asymmetric: a wrong password and an unknown
 * email both return the same generic 401 after the same amount of work, while
 * a locked or disabled account returns a specific 422 (per docs/08-api.md §2)
 * because a user who cannot get in needs to be told why.
 */
export async function login(input: LoginInput, meta: RequestMeta): Promise<LoginResult> {
  const email = input.email.toLowerCase();

  // Read in its own short transaction. Everything that follows either needs no
  // transaction at all (password verification) or needs one that COMMITS —
  // which the old single-transaction shape could not provide, because the
  // failure path threw, and throwing out of `$transaction` rolls back. The
  // failed-attempt counter was being discarded on every wrong password, which
  // silently disabled account lockout entirely.
  const user = await withPlatform((tx) =>
    tx.user.findFirst({
      where: { email },
      select: {
        id: true,
        companyId: true,
        email: true,
        passwordHash: true,
        status: true,
        sessionVersion: true,
        failedLoginCount: true,
        lockedUntil: true,
        employee: {
          select: { id: true, firstName: true, lastName: true, deletedAt: true, status: true },
        },
        userRoles: {
          select: {
            role: {
              select: {
                name: true,
                rolePermissions: { select: { permission: { select: { code: true } } } },
              },
            },
          },
        },
      },
    }),
  );

  if (!user) {
    // Burn the same CPU an argon2 verify would, so response time does not
    // reveal whether the address exists.
    await verifyPassword(await dummyHash(), input.password);
    throw new AuthError("Invalid email or password");
  }

  const settings = await withPlatform((tx) =>
    getSettings(tx as unknown as TenantTx, user.companyId),
  );

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new BusinessRuleError("Account is temporarily locked. Try again later.", {
      rule: "account_locked",
      until: user.lockedUntil.toISOString(),
    });
  }

  if (user.status === "disabled") {
    throw new BusinessRuleError("This account has been disabled.", {
      rule: "account_disabled",
    });
  }

  // `invited` accounts have no password yet. Saying so would confirm the
  // address exists, so it looks like any other bad credential.
  if (user.status !== "active" || !user.passwordHash) {
    await verifyPassword(await dummyHash(), input.password);
    throw new AuthError("Invalid email or password");
  }

  // Deliberately outside any transaction: argon2 is tuned to ~100 ms, and
  // holding a pooled connection for that long would serialise logins against
  // the small pool a serverless deployment runs with.
  const valid = await verifyPassword(user.passwordHash, input.password);

  if (!valid) {
    const lockedUntil = await withPlatform((tx) =>
      registerFailedAttempt(tx, {
        userId: user.id,
        companyId: user.companyId,
        email,
        failedLoginCount: user.failedLoginCount,
        threshold: settings["security.lockout_threshold"],
        baseLockoutMinutes: settings["security.lockout_minutes"],
        meta,
      }),
    );

    // After the commit, so the notification cannot outlive a rolled-back lock.
    if (lockedUntil) {
      await enqueue(
        "send-email",
        {
          to: email,
          subject: "Your HRMS account has been temporarily locked",
          ...lockoutEmailBody(lockedUntil),
        },
        { requestId: meta.requestId },
      );
    }

    throw new AuthError("Invalid email or password");
  }

  // An employee who has exited keeps no way in, whatever the account says.
  if (user.employee && (user.employee.status === "exited" || user.employee.deletedAt)) {
    throw new BusinessRuleError("This account has been disabled.", { rule: "account_disabled" });
  }

  await withPlatform(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await emit(
      "auth.logged_in",
      { userId: user.id },
      actorFor(meta, user.companyId, user.id, tx as unknown as TenantTx),
    );
  });

  const roles = user.userRoles.map((r) => r.role.name);
  const permissions = [
    ...new Set(
      user.userRoles.flatMap((r) =>
        r.role.rolePermissions.map((rp) => rp.permission.code as PermissionCode),
      ),
    ),
  ];

  return {
    token: await createSessionToken({
      userId: user.id,
      companyId: user.companyId,
      sessionVersion: user.sessionVersion,
    }),
    user: {
      id: user.id,
      email: user.email,
      companyId: user.companyId,
      employeeId: user.employee?.id ?? null,
      firstName: user.employee?.firstName ?? null,
      lastName: user.employee?.lastName ?? null,
    },
    roles,
    permissions,
  };
}

type PlatformTx = Parameters<Parameters<typeof withPlatform>[0]>[0];

/**
 * Count the failure and lock the account once it crosses the threshold.
 *
 * The lock doubles with each further threshold crossed (15 → 30 → 60 …,
 * capped at a day), so a persistent attacker is slowed exponentially while a
 * user who fat-fingered their password five times waits a quarter of an hour.
 */
async function registerFailedAttempt(
  tx: PlatformTx,
  args: {
    userId: string;
    companyId: string;
    email: string;
    failedLoginCount: number;
    threshold: number;
    baseLockoutMinutes: number;
    meta: RequestMeta;
  },
): Promise<Date | null> {
  const failed = args.failedLoginCount + 1;
  const lockLevel = Math.floor(failed / args.threshold);

  let lockedUntil: Date | null = null;
  if (lockLevel >= 1 && failed % args.threshold === 0) {
    const minutes = Math.min(args.baseLockoutMinutes * 2 ** (lockLevel - 1), 24 * 60);
    lockedUntil = new Date(Date.now() + minutes * 60_000);
  }

  await tx.user.update({
    where: { id: args.userId },
    data: { failedLoginCount: failed, ...(lockedUntil ? { lockedUntil } : {}) },
  });

  const actor = actorFor(args.meta, args.companyId, args.userId, tx as unknown as TenantTx);

  await emit("auth.login_failed", { email: args.email, reason: "bad_credentials" }, actor);

  if (lockedUntil) {
    await emit(
      "auth.account_locked",
      { userId: args.userId, until: lockedUntil.toISOString() },
      actor,
    );
  }

  // The caller sends the notification once this transaction has committed.
  return lockedUntil;
}

function lockoutEmailBody(until: Date): { html: string; text: string } {
  const when = until.toUTCString();
  const text =
    `Your HRMS account was locked after several failed sign-in attempts. ` +
    `You can try again after ${when}. If this was not you, contact your HR administrator.`;
  return {
    text,
    html: renderEmailShell(
      "Account temporarily locked",
      `<p style="margin:0;line-height:1.6">${escapeHtml(text)}</p>`,
    ),
  };
}

// ─────────────────────────────────────────────── logout

export async function logout(ctx: RequestContext): Promise<void> {
  await emit(
    "auth.logged_out",
    { userId: ctx.userId },
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

/** "Log out everywhere": invalidate every token already issued for this user. */
export async function revokeAllSessions(ctx: RequestContext, userId: string): Promise<void> {
  await ctx.db.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
}

// ─────────────────────────────────────────────── password reset

/**
 * Always reports success. Whether the address exists is not something an
 * unauthenticated caller gets to learn (docs/08-api.md §2).
 */
export async function forgotPassword(input: ForgotPasswordInput, meta: RequestMeta): Promise<void> {
  const email = input.email.toLowerCase();

  // Returns what to send, so the mail goes out after the token is committed
  // rather than from inside the transaction that creates it.
  const pending = await withPlatform(async (tx) => {
    const user = await tx.user.findFirst({
      where: { email },
      select: { id: true, companyId: true, email: true, status: true },
    });

    if (!user || user.status === "disabled") return null;

    const token = issueToken("reset");
    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: token.hash,
        kind: "reset",
        expiresAt: token.expiresAt,
      },
    });

    await emit(
      "auth.password_reset_requested",
      { userId: user.id },
      actorFor(meta, user.companyId, user.id, tx as unknown as TenantTx),
    );

    return { email: user.email, url: buildResetUrl(env.APP_URL, token.raw) };
  });

  if (!pending) return;

  await enqueue(
    "send-email",
    {
      to: pending.email,
      subject: "Reset your HRMS password",
      text: `Use this link within the next hour to set a new password: ${pending.url}`,
      html: renderEmailShell(
        "Reset your password",
        `<p style="margin:0 0 20px;line-height:1.6">This link is valid for one hour and can be used once.</p>
           <p style="margin:0"><a href="${escapeHtml(pending.url)}" style="display:inline-block;background:#C95A12;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Choose a new password</a></p>`,
      ),
    },
    { requestId: meta.requestId },
  );
}

/**
 * Consume an invite or reset token and set the password.
 *
 * On success: the token is marked used, every other outstanding token for the
 * account is burned, and `session_version` is bumped so any session opened
 * with the old password is dead. That last part is what makes a password reset
 * an actual remedy for a compromised account.
 */
export async function resetPassword(
  input: ResetPasswordInput,
  expectedKind: "reset" | "invite",
  meta: RequestMeta,
): Promise<void> {
  const tokenHash = hashToken(input.token);

  await withPlatform(async (tx) => {
    const row = await tx.passwordResetToken.findFirst({
      where: { tokenHash },
      select: {
        id: true,
        kind: true,
        usedAt: true,
        expiresAt: true,
        user: { select: { id: true, companyId: true, status: true } },
      },
    });

    const invalid = () =>
      new BusinessRuleError("This link is invalid or has expired. Request a new one.", {
        rule: "token_invalid_or_expired",
      });

    if (!row || row.usedAt || row.expiresAt <= new Date()) throw invalid();
    if (row.kind !== expectedKind) throw invalid();
    if (row.user.status === "disabled") throw invalid();

    const settings = await getSettings(tx as unknown as TenantTx, row.user.companyId);
    const policy = checkPasswordPolicy(input.password, settings["security.password_min_length"]);
    if (!policy.ok) {
      throw new ValidationError("Password does not meet the policy", {
        password: policy.problems,
      });
    }

    const passwordHash = await hashPassword(input.password);

    await tx.user.update({
      where: { id: row.user.id },
      data: {
        passwordHash,
        status: "active",
        failedLoginCount: 0,
        lockedUntil: null,
        sessionVersion: { increment: 1 },
      },
    });

    await tx.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });

    // Any other link sitting in an inbox is now dead.
    await tx.passwordResetToken.updateMany({
      where: { userId: row.user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await emit(
      expectedKind === "invite" ? "auth.invite_accepted" : "auth.password_reset",
      { userId: row.user.id },
      actorFor(meta, row.user.companyId, row.user.id, tx as unknown as TenantTx),
    );
  });
}

// ─────────────────────────────────────────────── invites

export interface InviteResult {
  userId: string;
  /** Only returned outside production, so local development needs no mailbox. */
  inviteUrl?: string;
}

/**
 * Create (or re-issue) an invite for an employee's user account.
 * Called by the employees module when HR ticks "invite" on a new hire.
 */
export async function inviteUser(
  ctx: RequestContext,
  args: { email: string; employeeId: string | null },
): Promise<InviteResult> {
  const email = args.email.toLowerCase();

  const existing = await ctx.db.user.findFirst({
    where: { email },
    select: { id: true, status: true },
  });

  let userId: string;

  if (existing) {
    if (existing.status === "active") {
      throw new BusinessRuleError("This person already has an active account.", {
        rule: "user_exists",
      });
    }
    userId = existing.id;
    await ctx.db.user.update({
      where: { id: userId },
      data: { status: "invited", failedLoginCount: 0, lockedUntil: null },
    });
  } else {
    const created = await ctx.db.user.create({
      data: { companyId: ctx.companyId, email, status: "invited" },
      select: { id: true },
    });
    userId = created.id;
  }

  if (args.employeeId) {
    await ctx.db.employee.update({
      where: { id: args.employeeId },
      data: { userId },
    });
  }

  // Supersede any invite already outstanding for this account.
  await ctx.db.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = issueToken("invite");
  await ctx.db.passwordResetToken.create({
    data: { userId, tokenHash: token.hash, kind: "invite", expiresAt: token.expiresAt },
  });

  await emit(
    "user.invited",
    { userId, email, employeeId: args.employeeId },
    {
      userId: ctx.userId,
      companyId: ctx.companyId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      db: ctx.db,
    },
  );

  const url = buildInviteUrl(env.APP_URL, token.raw);
  await enqueue(
    "send-email",
    {
      to: email,
      subject: "You have been invited to HRMS",
      text: `You have been invited to HRMS. Set your password within 7 days: ${url}`,
      html: renderEmailShell(
        "Welcome to HRMS",
        `<p style="margin:0 0 20px;line-height:1.6">Your account is ready. Set a password to sign in. This link is valid for 7 days.</p>
         <p style="margin:0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#C95A12;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Set your password</a></p>`,
      ),
    },
    { requestId: ctx.requestId },
  );

  return {
    userId,
    ...(env.NODE_ENV === "production" ? {} : { inviteUrl: url }),
  };
}

// ─────────────────────────────────────────────── me

export async function me(ctx: RequestContext) {
  const user = await ctx.db.user.findFirst({
    where: { id: ctx.userId },
    select: {
      id: true,
      email: true,
      status: true,
      lastLoginAt: true,
      company: { select: { id: true, name: true, slug: true, timezone: true, currency: true } },
      employee: {
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          photoKey: true,
          status: true,
          joinDate: true,
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, title: true } },
          location: { select: { id: true, name: true } },
          manager: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });

  if (!user) throw new AuthError();

  return {
    user: { id: user.id, email: user.email, status: user.status, lastLoginAt: user.lastLoginAt },
    company: user.company,
    employee: user.employee,
    roles: ctx.roles,
    permissions: [...ctx.permissions],
  };
}

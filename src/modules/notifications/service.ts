import type { RequestContext } from "@/lib/context";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";
import type { PermissionCode } from "@/lib/permissions";

/**
 * In-app notifications and HR announcements.
 *
 * A notification is one row per recipient and is never soft-deleted — it is a
 * fact about something that happened, and `read_at` is what hides it.
 *
 * An announcement is one row for everybody, with read receipts alongside.
 * Fanning a company-wide message out to a row per employee would turn one
 * announcement into a thousand writes and make editing it impossible.
 */

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

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
}

/**
 * Create notifications.
 *
 * Takes a list rather than one, because every caller is fanning out to a set
 * — an approver, a team, everybody in a department — and a loop of single
 * inserts is the slow way to write the same rows.
 */
export async function notify(ctx: DataContext, inputs: NotifyInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  const created = await ctx.db.notification.createMany({
    data: inputs.map((n) => ({
      companyId: ctx.companyId,
      userId: n.userId,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link ?? null,
    })),
  });
  return created.count;
}

/** The user account behind an employee, when they have one. */
export async function userIdForEmployee(
  ctx: DataContext,
  employeeId: string,
): Promise<string | null> {
  const employee = await ctx.db.employee.findFirst({
    where: { id: employeeId },
    select: { userId: true },
  });
  return employee?.userId ?? null;
}

/**
 * Everyone who holds a permission, for the notices addressed to a role rather
 * than a person ("all HR users", "the people who can approve this").
 *
 * Resolved through the permission, never through a role name, for the same
 * reason feature code is: a custom role in Phase 3 that carries
 * `leave.view_all` should start receiving HR notices without a code change.
 */
export async function userIdsWithPermission(
  ctx: DataContext,
  code: PermissionCode,
): Promise<string[]> {
  const users = await ctx.db.user.findMany({
    where: {
      status: "active",
      userRoles: { some: { role: { rolePermissions: { some: { permission: { code } } } } } },
    },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

/** Whoever should decide on this employee's requests. */
export async function approverUserIdFor(
  ctx: DataContext,
  employeeId: string,
): Promise<string | null> {
  const employee = await ctx.db.employee.findFirst({
    where: { id: employeeId },
    select: { manager: { select: { userId: true } } },
  });
  return employee?.manager?.userId ?? null;
}

// ─────────────────────────────────────────────── reading

export async function listNotifications(
  ctx: RequestContext,
  input: { unreadOnly?: boolean; limit?: number },
) {
  const rows = await ctx.db.notification.findMany({
    where: { userId: ctx.userId, ...(input.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? 50,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      link: true,
      readAt: true,
      createdAt: true,
    },
  });

  const unread = await ctx.db.notification.count({
    where: { userId: ctx.userId, readAt: null },
  });

  return { data: rows, unread };
}

/**
 * Mark one as read, or all of them.
 *
 * Scoped to the caller's own rows in the query rather than checked afterwards,
 * so marking somebody else's notification read is not merely refused — it
 * matches nothing.
 */
export async function markRead(ctx: RequestContext, id?: string) {
  const now = new Date();

  if (id) {
    const result = await ctx.db.notification.updateMany({
      where: { id, userId: ctx.userId, readAt: null },
      data: { readAt: now },
    });
    return { marked: result.count };
  }

  const result = await ctx.db.notification.updateMany({
    where: { userId: ctx.userId, readAt: null },
    data: { readAt: now },
  });
  return { marked: result.count };
}

// ─────────────────────────────────────────────── announcements

const ANNOUNCEMENT_FIELDS = {
  id: true,
  title: true,
  bodyHtml: true,
  audience: true,
  departmentId: true,
  publishedAt: true,
  createdAt: true,
  department: { select: { id: true, name: true } },
  author: { select: { id: true, email: true } },
} as const;

/**
 * Strip everything that could execute or exfiltrate.
 *
 * An allowlist, not a blocklist: anything not named here is removed, so a tag
 * nobody thought of is safe by default rather than dangerous by omission. HR
 * writes these, but "trusted author" is not a security model — a compromised
 * HR account should not become stored XSS for the whole company.
 */
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "h2",
  "h3",
  "blockquote",
  "a",
]);

export function sanitizeHtml(input: string): string {
  // Drop whole elements whose content is never renderable text.
  let html = input.replace(/<(script|style|iframe|object|embed|form|svg|math)[\s\S]*?<\/\1>/gi, "");

  html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match, rawTag, attrs) => {
    const tag = String(rawTag).toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    if (match.startsWith("</")) return `</${tag}>`;

    // Links keep an href, and only one that cannot execute. Everything else
    // goes, which takes every on* handler with it.
    if (tag === "a") {
      const href = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(String(attrs));
      const url = (href?.[2] ?? href?.[3] ?? "").trim();

      // Scheme must be one that cannot execute, and the value must contain
      // nothing that could be mistaken for markup. Encoded quotes do not
      // actually escape an attribute, but a URL carrying them is malformed
      // and there is no reason to emit one.
      const safeScheme = /^(https?:\/\/|mailto:|\/)/i.test(url);
      const clean = !/["'<>\s]|&#|&quot;|&apos;/i.test(url);

      return safeScheme && clean
        ? `<a href="${url}" rel="noopener noreferrer" target="_blank">`
        : "<a>";
    }
    return `<${tag}>`;
  });

  return html.trim();
}

export async function listAnnouncements(ctx: RequestContext, includeDrafts: boolean) {
  // An employee sees what is published and aimed at them. Drafts and other
  // departments' messages are filtered in the query, never in the client.
  const employee = ctx.employeeId
    ? await ctx.db.employee.findFirst({
        where: { id: ctx.employeeId },
        select: { departmentId: true },
      })
    : null;

  const rows = await ctx.db.announcement.findMany({
    where: includeDrafts
      ? {}
      : {
          publishedAt: { not: null, lte: new Date() },
          OR: [
            { audience: "company" },
            { audience: "department", departmentId: employee?.departmentId ?? undefined },
          ],
        },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      ...ANNOUNCEMENT_FIELDS,
      reads: { where: { userId: ctx.userId }, select: { id: true } },
    },
  });

  return rows.map(({ reads, ...row }) => ({ ...row, read: reads.length > 0 }));
}

export async function createAnnouncement(
  ctx: RequestContext,
  input: {
    title: string;
    bodyHtml: string;
    audience: "company" | "department";
    departmentId?: string | null;
    publish: boolean;
  },
) {
  if (input.audience === "department" && !input.departmentId) {
    throw new ConflictError("Choose a department, or send this to the whole company.");
  }
  if (input.departmentId) {
    const department = await ctx.db.department.findFirst({
      where: { id: input.departmentId },
      select: { id: true },
    });
    if (!department) throw new NotFoundError("Department");
  }

  const announcement = await ctx.db.announcement.create({
    data: {
      companyId: ctx.companyId,
      title: input.title,
      // Sanitised on the way in, so what is stored is already safe and no
      // reader has to remember to clean it.
      bodyHtml: sanitizeHtml(input.bodyHtml),
      audience: input.audience,
      departmentId: input.audience === "department" ? (input.departmentId ?? null) : null,
      publishedAt: input.publish ? new Date() : null,
      createdBy: ctx.userId,
    },
    select: ANNOUNCEMENT_FIELDS,
  });

  if (input.publish) await fanOutAnnouncement(ctx, announcement.id);

  await emit(
    "announcement.changed",
    { announcementId: announcement.id, action: input.publish ? "published" : "drafted" },
    actor(ctx),
  );
  return announcement;
}

export async function publishAnnouncement(ctx: RequestContext, id: string) {
  const announcement = await ctx.db.announcement.findFirst({
    where: { id },
    select: { id: true, publishedAt: true },
  });
  if (!announcement) throw new NotFoundError("Announcement");
  if (announcement.publishedAt) throw new ConflictError("This is already published.");

  const updated = await ctx.db.announcement.update({
    where: { id },
    data: { publishedAt: new Date() },
    select: ANNOUNCEMENT_FIELDS,
  });

  await fanOutAnnouncement(ctx, id);
  await emit("announcement.changed", { announcementId: id, action: "published" }, actor(ctx));
  return updated;
}

export async function deleteAnnouncement(ctx: RequestContext, id: string) {
  const announcement = await ctx.db.announcement.findFirst({
    where: { id },
    select: { id: true },
  });
  if (!announcement) throw new NotFoundError("Announcement");

  await ctx.db.announcement.update({ where: { id }, data: { deletedAt: new Date() } });
  await emit("announcement.changed", { announcementId: id, action: "deleted" }, actor(ctx));
}

/** A notification each, so a published announcement actually reaches people. */
async function fanOutAnnouncement(ctx: RequestContext, id: string) {
  const announcement = await ctx.db.announcement.findFirst({
    where: { id },
    select: { id: true, title: true, audience: true, departmentId: true },
  });
  if (!announcement) return;

  const employees = await ctx.db.employee.findMany({
    where: {
      status: { not: "exited" },
      userId: { not: null },
      ...(announcement.audience === "department"
        ? { departmentId: announcement.departmentId ?? undefined }
        : {}),
    },
    select: { userId: true },
  });

  await notify(
    ctx,
    employees
      .filter((e): e is { userId: string } => e.userId !== null)
      .map((e) => ({
        userId: e.userId,
        type: "announcement.published",
        title: announcement.title,
        body: "A new announcement was posted.",
        link: "/me/notifications",
      })),
  );
}

export async function markAnnouncementRead(ctx: RequestContext, id: string) {
  const announcement = await ctx.db.announcement.findFirst({
    where: { id },
    select: { id: true },
  });
  if (!announcement) throw new NotFoundError("Announcement");

  await ctx.db.announcementRead.upsert({
    where: { announcementId_userId: { announcementId: id, userId: ctx.userId } },
    create: { companyId: ctx.companyId, announcementId: id, userId: ctx.userId },
    update: {},
  });
  return { ok: true };
}

/** Guard for the composer, which is HR-only. */
export function assertCanAnnounce(ctx: RequestContext): void {
  if (!ctx.permissions.has("announcements.create")) {
    throw new ForbiddenError("You cannot post announcements");
  }
}

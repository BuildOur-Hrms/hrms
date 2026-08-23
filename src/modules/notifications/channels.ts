import { env } from "@/lib/env";
import { escapeHtml, renderEmailShell } from "@/lib/email";
import { queueEmail } from "@/lib/outbox";

import type { DataContext, NotifyInput } from "./service";

/**
 * Which notices also go out by email.
 *
 * Taken from the channel column of the catalog in
 * docs/07-workflows-and-automation.md §3. Everything else is in-app only, and
 * deliberately so: a system that emails about every event is a system whose
 * emails get filtered, and then the ones that mattered go unread too.
 *
 * The rule of thumb behind the list is whether the notice asks the recipient
 * to do something they cannot see from the app they are not currently in. An
 * approval waiting on you does. Somebody's birthday does not.
 *
 * Per-user toggles are Phase 2. Until then this map is the whole policy, in
 * one place, matching the document it came from.
 */
const EMAIL_TYPES: ReadonlySet<string> = new Set([
  "leave.requested",
  "leave.reviewed",
  "attendance.correction_requested",
  "attendance.correction_reviewed",
  "attendance.absent_no_leave",
  "probation.ending",
]);

export function emailsFor(notices: NotifyInput[]): NotifyInput[] {
  return notices.filter((notice) => EMAIL_TYPES.has(notice.type));
}

/**
 * Queue the email copies of a batch of notices.
 *
 * Addresses are resolved in one query rather than one per recipient, and a
 * user without an address is simply skipped — the in-app row is still there,
 * which is the point of having two channels.
 */
export async function queueNotificationEmails(
  ctx: DataContext,
  notices: NotifyInput[],
): Promise<number> {
  const wanted = emailsFor(notices);
  if (wanted.length === 0) return 0;

  const users = await ctx.db.user.findMany({
    where: { id: { in: [...new Set(wanted.map((n) => n.userId))] }, status: "active" },
    select: { id: true, email: true },
  });
  const addressOf = new Map(users.map((user) => [user.id, user.email]));

  let queued = 0;
  for (const notice of wanted) {
    const to = addressOf.get(notice.userId);
    if (!to) continue;

    queueEmail({
      to,
      subject: notice.title,
      text: notice.link ? `${notice.body}\n\n${absolute(notice.link)}` : notice.body,
      html: renderEmailShell(notice.title, body(notice)),
    });
    queued++;
  }
  return queued;
}

function absolute(link: string): string {
  return `${env.APP_URL.replace(/\/$/, "")}${link}`;
}

function body(notice: NotifyInput): string {
  const paragraph = `<p style="margin:0 0 20px;line-height:1.6">${escapeHtml(notice.body)}</p>`;
  if (!notice.link) return paragraph;

  return `${paragraph}
           <p style="margin:0"><a href="${escapeHtml(absolute(notice.link))}" style="display:inline-block;background:#C95A12;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open in HRMS</a></p>`;
}

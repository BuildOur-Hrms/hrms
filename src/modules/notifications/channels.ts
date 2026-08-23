import { env } from "@/lib/env";
import { escapeHtml, renderEmailShell } from "@/lib/email";
import { queueEmail } from "@/lib/outbox";
import { getSetting } from "@/modules/settings/service";

import type { DataContext, NotifyInput } from "./service";

/**
 * Which notices also go out by email.
 *
 * The policy is a company setting, not a constant:
 * `notifications.email_enabled` turns the channel off entirely, and
 * `notifications.email_events` names the event keys that use it. Both default
 * to the channel column of the catalog in
 * docs/07-workflows-and-automation.md §3.
 *
 * Everything else stays in-app, and deliberately so: a system that emails
 * about every event is a system whose emails get filtered, and then the ones
 * that mattered go unread too.
 */

/** Pure half, so the policy can be tested without a database. */
export function emailsFor(notices: NotifyInput[], allowed: ReadonlySet<string>): NotifyInput[] {
  return notices.filter((notice) => allowed.has(notice.type));
}

/**
 * Queue the email copies of a batch of notices.
 *
 * Addresses are resolved in one query rather than one per recipient, and a
 * user without an active account is skipped — the in-app row is still there,
 * which is the point of having two channels.
 */
export async function queueNotificationEmails(
  ctx: DataContext,
  notices: NotifyInput[],
): Promise<number> {
  if (notices.length === 0) return 0;

  const enabled = await getSetting(ctx.db, ctx.companyId, "notifications.email_enabled");
  if (!enabled) return 0;

  const events = await getSetting(ctx.db, ctx.companyId, "notifications.email_events");
  const wanted = emailsFor(notices, new Set(events));
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

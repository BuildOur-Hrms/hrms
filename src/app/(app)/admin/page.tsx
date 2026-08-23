import type { Metadata } from "next";
import Link from "next/link";
import { Check, CircleAlert, FileClock, ShieldCheck, UserCheck, UserPlus } from "lucide-react";

import { ButtonLink } from "@/components/shared/button-link";
import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { PanelTile } from "@/components/shared/panel-tile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { pageCan, requireSession, withPageData } from "@/lib/page";
import { adminHome } from "@/modules/dashboard/service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Administration" };

/**
 * The admin panel home.
 *
 * `/admin` used to 404 — it was a section with no index, which is a URL people
 * reasonably guess. It now answers the two questions an administrator has:
 * who has access, and is this company actually configured.
 */
export default async function AdminHomePage() {
  const session = await requireSession();

  // Any of the administration permissions opens this page; the panels below
  // are all read-only summaries pointing at screens that gate themselves.
  const canOpen =
    pageCan(session, "users.view_all") ||
    pageCan(session, "roles.view_all") ||
    pageCan(session, "company.manage") ||
    pageCan(session, "settings.manage") ||
    pageCan(session, "audit.view_all");

  if (!canOpen) {
    return <NoAccess required="users.view_all" what="the administration panel" />;
  }

  const data = await withPageData(session, (db) => adminHome({ db, companyId: session.companyId }));

  const outstanding = data.setup.filter((item) => !item.done);

  return (
    <>
      <PageHeader
        title="Administration"
        description={`${session.company.name} — access, configuration and the audit trail.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PanelTile
          label="Active users"
          value={data.users.active}
          hint="Can sign in"
          href="/admin/roles"
          icon={UserCheck}
        />
        <PanelTile
          label="Invited"
          value={data.users.invited}
          hint="Have not set a password"
          href="/admin/roles"
          icon={UserPlus}
          tone="attention"
        />
        <PanelTile
          label="Disabled"
          value={data.users.disabled}
          hint="Access revoked"
          icon={CircleAlert}
        />
        <PanelTile
          label="Roles"
          value={data.roles}
          hint="Permission sets"
          href="/admin/roles"
          icon={ShieldCheck}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Setup</CardTitle>
            <CardDescription>
              {outstanding.length === 0
                ? "Everything the other modules depend on is configured."
                : // Each of these is silently fine until the day it is not.
                  `${outstanding.length} thing${outstanding.length === 1 ? "" : "s"} still to configure. Each one changes what other modules compute.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5">
              {data.setup.map((item) => (
                <li key={item.key} className="flex items-start gap-2.5 text-sm">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
                      item.done ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
                    )}
                  >
                    {item.done ? <Check className="size-3" /> : <CircleAlert className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Link href={item.href} className="hover:text-brand font-medium">
                      {item.label}
                    </Link>
                    <span className="text-muted-foreground block text-xs">{item.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>The last few audited actions.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.recentAudit.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing audited yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.recentAudit.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-2 text-sm">
                    <FileClock className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="font-mono text-xs">{entry.action}</span>
                    <span className="text-muted-foreground min-w-0 flex-1 truncate">
                      {entry.actor}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {entry.at.slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {pageCan(session, "audit.view_all") ? (
              <div className="mt-4">
                <ButtonLink href="/admin/audit-logs" variant="outline" size="sm">
                  Open audit log
                </ButtonLink>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

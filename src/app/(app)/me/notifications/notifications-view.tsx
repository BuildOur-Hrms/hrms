"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Announcement {
  id: string;
  title: string;
  bodyHtml: string;
  audience: "company" | "department";
  publishedAt: string | null;
  department: { id: string; name: string } | null;
  author: { id: string; email: string };
  read: boolean;
}

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function NotificationsView() {
  const queryClient = useQueryClient();

  const notifications = useQuery({
    queryKey: ["notifications", "all"],
    queryFn: ({ signal }) =>
      api.get<{ data: Notification[]; unread: number }>("/notifications", undefined, signal),
  });

  const announcements = useQuery({
    queryKey: ["announcements"],
    queryFn: ({ signal }) => api.get<Announcement[]>("/announcements", undefined, signal),
  });

  const markAll = useMutation({
    mutationFn: () => api.post("/notifications/read", {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAnnouncement = useMutation({
    mutationFn: (id: string) => api.post(`/announcements/${id}/read`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["announcements"] }),
  });

  const items = notifications.data?.data ?? [];
  const unread = notifications.data?.unread ?? 0;
  const posts = announcements.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>
              Notifications
              {unread > 0 ? (
                <Badge
                  variant="secondary"
                  className="bg-brand-soft text-brand-soft-foreground ml-2"
                >
                  {unread} unread
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription>Things that happened, and what needs you.</CardDescription>
          </div>
          {unread > 0 ? (
            <Button variant="outline" size="sm" onClick={() => markAll.mutate()}>
              Mark all read
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {notifications.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : items.length === 0 ? (
            <EmptyState
              title="Nothing yet"
              description="Notifications appear here as things happen."
            />
          ) : (
            <ul className="divide-border divide-y">
              {items.map((n) => (
                <li key={n.id} className="py-3">
                  <div className="flex items-baseline gap-2">
                    {!n.readAt ? (
                      <span aria-hidden className="bg-brand size-1.5 shrink-0 rounded-full" />
                    ) : null}
                    <span className={cn("min-w-0 flex-1", !n.readAt && "font-medium")}>
                      {n.link ? (
                        <Link href={n.link} className="hover:text-brand">
                          {n.title}
                        </Link>
                      ) : (
                        n.title
                      )}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {longDate(n.createdAt)}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-0.5 pl-3.5 text-sm">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Announcements</CardTitle>
          <CardDescription>Posted by HR to the company or your department.</CardDescription>
        </CardHeader>
        <CardContent>
          {announcements.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : posts.length === 0 ? (
            <EmptyState icon={Megaphone} title="No announcements" />
          ) : (
            <ul className="space-y-4">
              {posts.map((a) => (
                <li key={a.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.title}</span>
                    {a.audience === "department" && a.department ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        {a.department.name}
                      </Badge>
                    ) : null}
                    {!a.read ? (
                      <Badge
                        variant="secondary"
                        className="bg-brand-soft text-brand-soft-foreground"
                      >
                        New
                      </Badge>
                    ) : null}
                    <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                      {a.publishedAt ? longDate(a.publishedAt) : "Draft"}
                    </span>
                  </div>

                  {/*
                    Sanitised server-side before it was ever stored, with an
                    allowlist — so what is in the column is already safe and
                    this is not trusting the database to be clean.
                  */}
                  <div
                    className="prose-sm mt-2 text-sm [&_a]:underline [&_li]:ml-4 [&_li]:list-disc"
                    dangerouslySetInnerHTML={{ __html: a.bodyHtml }}
                  />

                  {!a.read ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      onClick={() => markAnnouncement.mutate(a.id)}
                    >
                      Mark as read
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

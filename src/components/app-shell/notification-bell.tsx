"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

/** `2026-08-24T…` → `24 Aug`. Enough to place it without stealing the row. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["notifications", "bell"],
    queryFn: ({ signal }) =>
      api.get<{ data: Notification[]; unread: number }>("/notifications", { limit: "10" }, signal),
    // Quiet background polling: a notification nobody sees until they reload
    // is not much of a notification.
    refetchInterval: 60_000,
  });

  const markAll = useMutation({
    mutationFn: () => api.post("/notifications/read", {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => api.post("/notifications/read", { id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const items = data?.data ?? [];
  const unread = data?.unread ?? 0;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          />
        }
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="bg-brand text-brand-foreground absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full text-[0.6rem] font-semibold tabular-nums">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </Button>
          ) : null}
        </div>
        <DropdownMenuSeparator />

        {items.length === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-sm">Nothing yet.</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {items.map((n) => {
              const body = (
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    {!n.readAt ? (
                      <span
                        aria-hidden
                        className="bg-brand mt-1.5 size-1.5 shrink-0 rounded-full"
                      />
                    ) : null}
                    <span
                      className={cn("min-w-0 flex-1 truncate text-sm", !n.readAt && "font-medium")}
                    >
                      {n.title}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {shortDate(n.createdAt)}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-0.5 line-clamp-2 pl-3.5 text-xs">
                    {n.body}
                  </p>
                </div>
              );

              return (
                <li key={n.id} className="hover:bg-muted/60 border-b last:border-b-0">
                  {n.link ? (
                    // Opening it is what "read" means, so the click does both.
                    <Link
                      href={n.link}
                      className="block px-3 py-2.5"
                      onClick={() => {
                        setOpen(false);
                        if (!n.readAt) markOne.mutate(n.id);
                      }}
                    >
                      {body}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="block w-full px-3 py-2.5 text-left"
                      onClick={() => !n.readAt && markOne.mutate(n.id)}
                    >
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <DropdownMenuSeparator />
        <Link
          href="/me/notifications"
          className="hover:text-brand block px-3 py-2 text-center text-sm"
          onClick={() => setOpen(false)}
        >
          See all
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

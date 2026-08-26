"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    /*
     * The shadow on the cut edge is the only thing telling somebody the table
     * scrolls. On a phone the scrollbar is invisible until you already know
     * to swipe, so a table wider than the screen simply looks truncated —
     * which is what it looked like here.
     *
     * Two gradients pinned with `local` mask the shadows when there is
     * nothing more to see in that direction, so the hint appears exactly when
     * it is true and costs no JavaScript to work out.
     */
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto [background:linear-gradient(to_right,var(--card)_30%,transparent)_left/1.5rem_100%_no-repeat_local,linear-gradient(to_left,var(--card)_30%,transparent)_right/1.5rem_100%_no-repeat_local,radial-gradient(farthest-side_at_0_50%,rgb(0_0_0/0.14),transparent)_left/0.75rem_100%_no-repeat_scroll,radial-gradient(farthest-side_at_100%_50%,rgb(0_0_0/0.14),transparent)_right/0.75rem_100%_no-repeat_scroll]"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-muted/50 [&_tr]:border-b", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("bg-muted/50 border-t font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-accent/40 has-aria-expanded:bg-accent/40 data-[state=selected]:bg-accent border-b transition-colors",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-muted-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0", className)}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };

import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A number on a panel home.
 *
 * Optionally a link, because most numbers on a landing page are really a
 * question — "three waiting on me" is only useful if it takes you to them.
 */
export function PanelTile({
  label,
  value,
  hint,
  href,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  icon?: LucideIcon;
  /** `attention` for a number somebody has to act on. */
  tone?: "default" | "attention";
}) {
  const body = (
    <CardContent className="flex items-start justify-between gap-3 p-5">
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          {label}
        </p>
        <p
          className={cn(
            "mt-1.5 text-2xl font-semibold tabular-nums",
            tone === "attention" && Number(value) > 0 && "text-brand",
          )}
        >
          {value}
        </p>
        {hint ? <p className="text-muted-foreground mt-1 truncate text-xs">{hint}</p> : null}
      </div>
      {Icon ? (
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            tone === "attention" && Number(value) > 0
              ? "bg-brand-soft text-brand-soft-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-4" />
        </div>
      ) : null}
    </CardContent>
  );

  if (!href) return <Card>{body}</Card>;

  return (
    <Card className="hover:border-brand/30 transition-colors">
      <Link href={href} className="block">
        {body}
      </Link>
    </Card>
  );
}

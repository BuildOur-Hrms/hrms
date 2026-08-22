import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            {label}
          </p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
          {hint ? <p className="text-muted-foreground mt-1 truncate text-xs">{hint}</p> : null}
        </div>
        {Icon ? (
          <div className="bg-brand-soft text-brand-soft-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
            <Icon className="size-4" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

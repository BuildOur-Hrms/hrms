import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-card/60 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center">
      {Icon ? (
        <div className="bg-brand-soft text-brand-soft-foreground flex size-11 items-center justify-center rounded-full">
          <Icon className="size-5" />
        </div>
      ) : null}
      <div>
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="text-muted-foreground mt-1 max-w-md text-sm">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

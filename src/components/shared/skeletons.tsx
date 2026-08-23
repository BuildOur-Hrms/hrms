import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholders.
 *
 * Shaped like the content they stand in for, so the layout does not jump when
 * real data arrives — a skeleton that is the wrong size is worse than a
 * spinner, because it promises something and then moves it.
 */

export function PageHeaderSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-72" />
      </div>
      {withAction ? <Skeleton className="h-8 w-32" /> : null}
    </div>
  );
}

export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i}>
          <CardContent className="flex items-start justify-between gap-3 p-5">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-12" />
            </div>
            <Skeleton className="size-9 rounded-lg" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="bg-card overflow-hidden rounded-xl border shadow-xs">
      <div className="bg-muted/40 flex gap-4 border-b px-4 py-3">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: columns }, (_, c) => (
              <Skeleton key={c} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FilterBarSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Skeleton className="h-8 min-w-56 flex-1" />
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-8 w-40" />
      ))}
    </div>
  );
}

export function DetailCardSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-4 w-40" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function ProfileHeaderSkeleton() {
  return (
    <div className="mb-6 flex items-center gap-3">
      <Skeleton className="size-12 rounded-full" />
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
    </div>
  );
}

/**
 * A panel home: a row of numbers, then the panels under them.
 *
 * The tiles are the part worth getting right. They are the first thing on the
 * screen and the first thing to arrive, so a placeholder that is the wrong
 * height makes the whole page jump the moment the data lands.
 */
export function PanelHomeSkeleton({ tiles = 4, panels = 2 }: { tiles?: number; panels?: number }) {
  return (
    <>
      <StatCardsSkeleton count={tiles} />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {Array.from({ length: panels }, (_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 4 }, (_, r) => (
                <Skeleton key={r} className="h-4 w-full" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

/** A grid of cards — the report catalog, the roles list. */
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i}>
          <CardContent className="space-y-3 p-5">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-8 w-28" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

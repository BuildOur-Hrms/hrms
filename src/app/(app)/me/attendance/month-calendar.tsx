"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface DayCell {
  date: string;
  weekOff: boolean;
  record: {
    status: string;
    workedMinutes: number;
    lateMinutes: number;
    overtimeMinutes: number;
    needsReview: boolean;
    locked: boolean;
  } | null;
}

interface MonthResponse {
  year: number;
  month: number;
  days: DayCell[];
  summary: {
    present: number;
    halfDay: number;
    absent: number;
    onLeave: number;
    workedMinutes: number;
    lateMinutes: number;
    overtimeMinutes: number;
    needsReview: number;
  };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Colour carries meaning here, so each status also carries a label in the
 * legend and a title on the cell — a calendar that can only be read by hue is
 * unreadable to a good number of people.
 */
const STATUS_STYLE: Record<string, { cell: string; label: string }> = {
  present: { cell: "bg-success/12 text-success border-success/20", label: "Present" },
  half_day: { cell: "bg-warning/15 text-warning border-warning/25", label: "Half day" },
  absent: { cell: "bg-destructive/10 text-destructive border-destructive/20", label: "Absent" },
  on_leave: { cell: "bg-info/12 text-info border-info/20", label: "On leave" },
  holiday: { cell: "bg-brand-soft text-brand-soft-foreground border-brand/20", label: "Holiday" },
  week_off: { cell: "bg-muted text-muted-foreground border-border", label: "Week off" },
};

function humanMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Monday-first offset for the 1st of the month. */
function leadingBlanks(days: DayCell[]): number {
  if (days.length === 0) return 0;
  const weekday = new Date(`${days[0]!.date}T00:00:00.000Z`).getUTCDay();
  return (weekday + 6) % 7;
}

export function MonthCalendar({ onPickDay }: { onPickDay?: (date: string) => void }) {
  const now = new Date();
  const [cursor, setCursor] = useState({
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["attendance", "month", cursor.year, cursor.month],
    queryFn: ({ signal }) =>
      api.get<MonthResponse>(
        "/attendance/month",
        { year: String(cursor.year), month: String(cursor.month) },
        signal,
      ),
  });

  function step(by: number) {
    setCursor((c) => {
      const next = new Date(Date.UTC(c.year, c.month - 1 + by, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
    });
  }

  const label = new Date(Date.UTC(cursor.year, cursor.month - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{label}</CardTitle>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous month"
            onClick={() => step(-1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => step(1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading || !data ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1.5">
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  className="text-muted-foreground pb-1 text-center text-xs font-semibold tracking-wider uppercase"
                >
                  {d}
                </div>
              ))}

              {Array.from({ length: leadingBlanks(data.days) }, (_, i) => (
                <div key={`blank-${i}`} />
              ))}

              {data.days.map((day) => {
                const status = day.record?.status ?? (day.weekOff ? "week_off" : null);
                const style = status ? STATUS_STYLE[status] : undefined;
                const dayNumber = Number(day.date.slice(8));
                return (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => onPickDay?.(day.date)}
                    title={
                      day.record
                        ? `${style?.label ?? status} · ${humanMinutes(day.record.workedMinutes)}`
                        : status
                          ? style?.label
                          : "Not calculated yet"
                    }
                    className={cn(
                      "flex min-h-14 flex-col items-start rounded-lg border px-1.5 py-1 text-left transition-colors",
                      style?.cell ?? "text-muted-foreground border-dashed",
                      onPickDay && "hover:ring-ring/40 hover:ring-2",
                    )}
                  >
                    <span className="text-xs font-medium tabular-nums">{dayNumber}</span>
                    {day.record ? (
                      <>
                        <span className="text-[0.65rem] leading-tight">
                          {humanMinutes(day.record.workedMinutes)}
                        </span>
                        {day.record.needsReview ? (
                          <span className="text-[0.65rem] leading-tight font-semibold">review</span>
                        ) : null}
                      </>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {Object.entries(STATUS_STYLE).map(([key, s]) => (
                <span key={key} className="flex items-center gap-1.5 text-xs">
                  <span className={cn("size-3 rounded border", s.cell)} />
                  {s.label}
                </span>
              ))}
              <span className="flex items-center gap-1.5 text-xs">
                <span className="border-border size-3 rounded border border-dashed" />
                Not calculated yet
              </span>
            </div>

            <div className="grid gap-3 border-t pt-4 sm:grid-cols-4">
              <Total label="Present" value={String(data.summary.present)} />
              <Total label="Half days" value={String(data.summary.halfDay)} />
              <Total label="Absent" value={String(data.summary.absent)} />
              <Total label="Overtime" value={humanMinutes(data.summary.overtimeMinutes)} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

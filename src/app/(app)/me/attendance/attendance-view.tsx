"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Clock, LogIn, LogOut, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api-client";

import { CorrectionsPanel } from "./corrections-panel";
import { MonthCalendar } from "./month-calendar";

interface Punch {
  id: string;
  punchedAt: string;
  direction: "in" | "out";
  source: string;
  note: string | null;
}

interface DayRecord {
  status: string;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  overtimeApproved: boolean;
  needsReview: boolean;
  locked: boolean;
}

interface DayResponse {
  workDate: string;
  timeZone: string;
  shift: { id: string; name: string; startTime: string; endTime: string; graceMinutes: number };
  punches: Punch[];
  record: DayRecord | null;
  checkedIn: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  half_day: "Half day",
  on_leave: "On leave",
  holiday: "Holiday",
  week_off: "Week off",
};

/** `495` → `8h 15m`, because raw minutes stop being readable past an hour. */
function humanMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * Punch times are rendered in the employee's own zone, not the browser's. A
 * laptop set to the wrong timezone should not change what the day looks like.
 */
function clock(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

export function AttendanceView() {
  const queryClient = useQueryClient();
  // Clicking a day in the calendar pre-fills the correction form with it,
  // which is the whole reason someone clicks a day that looks wrong.
  const [pickedDay, setPickedDay] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["attendance", "day"],
    queryFn: ({ signal }) => api.get<DayResponse>("/attendance/day", undefined, signal),
  });

  const punch = useMutation({
    mutationFn: (direction: "in" | "out") => api.post("/attendance/punch", { direction }),
    onSuccess: (_result, direction) => {
      toast.success(direction === "in" ? "Checked in" : "Checked out");
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Could not record that");
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-4 w-64" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    // The most likely cause is a real, fixable configuration gap rather than a
    // crash, so the message from the API is worth showing verbatim.
    const message =
      error instanceof ApiError
        ? error.message
        : "Something went wrong loading today's attendance.";
    return (
      <Card>
        <CardHeader>
          <CardTitle>Attendance unavailable</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const checkedIn = data.checkedIn;

  return (
    <div className="space-y-4">
      <TodayCard
        data={data}
        checkedIn={checkedIn}
        punching={punch.isPending}
        onPunch={(d) => punch.mutate(d)}
      />
      <MonthCalendar onPickDay={setPickedDay} />
      <CorrectionsPanel {...(pickedDay ? { defaultDate: pickedDay } : {})} />
    </div>
  );
}

function TodayCard({
  data,
  checkedIn,
  punching,
  onPunch,
}: {
  data: DayResponse;
  checkedIn: boolean;
  punching: boolean;
  onPunch: (direction: "in" | "out") => void;
}) {
  const { record, shift, punches, timeZone } = data;
  const worked = record?.workedMinutes ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today</CardTitle>
        <CardDescription>
          {data.workDate} · {shift.name} {shift.startTime}–{shift.endTime}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            variant={checkedIn ? "outline" : "default"}
            disabled={punching}
            onClick={() => onPunch(checkedIn ? "out" : "in")}
          >
            {punching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : checkedIn ? (
              <LogOut className="size-4" />
            ) : (
              <LogIn className="size-4" />
            )}
            {checkedIn ? "Check out" : "Check in"}
          </Button>

          {record ? (
            <Badge variant="secondary" className="bg-brand-soft text-brand-soft-foreground">
              {STATUS_LABEL[record.status] ?? record.status}
            </Badge>
          ) : null}

          {record?.needsReview ? (
            <Badge variant="secondary" className="bg-warning/12 text-warning">
              <AlertTriangle className="size-3" />
              Needs review
            </Badge>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Figure label="Worked" value={humanMinutes(worked)} />
          <Figure
            label="Late"
            value={record && record.lateMinutes > 0 ? humanMinutes(record.lateMinutes) : "—"}
          />
          <Figure
            label="Overtime"
            value={
              record && record.overtimeMinutes > 0 ? humanMinutes(record.overtimeMinutes) : "—"
            }
            hint={
              record?.overtimeMinutes
                ? record.overtimeApproved
                  ? "Approved"
                  : "Pending approval"
                : undefined
            }
          />
        </div>

        <div>
          <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
            Punches
          </p>
          {punches.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing recorded yet today.</p>
          ) : (
            <ul className="space-y-1.5">
              {punches.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <Clock
                    className={
                      p.direction === "in" ? "text-brand size-4" : "text-muted-foreground size-4"
                    }
                  />
                  <span className="font-medium">{p.direction === "in" ? "In" : "Out"}</span>
                  <span className="tabular-nums">{clock(p.punchedAt, timeZone)}</span>
                  {p.source !== "web" ? (
                    <Badge variant="outline" className="text-muted-foreground">
                      {p.source}
                    </Badge>
                  ) : null}
                  {p.note ? <span className="text-muted-foreground">{p.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

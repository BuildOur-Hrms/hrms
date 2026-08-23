"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { fullName } from "@/lib/utils";

interface Row {
  employee: {
    id: string;
    firstName: string;
    lastName: string | null;
    employeeCode: string;
    department: string | null;
  };
  record: {
    status: string;
    firstIn: string | null;
    lastOut: string | null;
    workedMinutes: number;
    lateMinutes: number;
    overtimeMinutes: number;
    needsReview: boolean;
    locked: boolean;
  } | null;
}

interface OverviewResponse {
  date: string;
  rows: Row[];
}

const STATUS_TINT: Record<string, string> = {
  present: "bg-success/12 text-success",
  half_day: "bg-warning/12 text-warning",
  absent: "bg-destructive/10 text-destructive",
  on_leave: "bg-info/12 text-info",
  holiday: "bg-brand-soft text-brand-soft-foreground",
  week_off: "bg-muted text-muted-foreground",
};

const STATUS_LABEL: Record<string, string> = {
  present: "Present",
  half_day: "Half day",
  absent: "Absent",
  on_leave: "On leave",
  holiday: "Holiday",
  week_off: "Week off",
};

function humanMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function clock(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : "—";
}

function shiftDate(date: string, by: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + by * 86_400_000).toISOString().slice(0, 10);
}

/**
 * One day across a group of people. Shared by the team and company screens,
 * which differ only in scope and in who is allowed to open them.
 */
export function AttendanceDayGrid({ scope }: { scope: "team" | "all" }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading, error } = useQuery({
    queryKey: ["attendance", "overview", scope, date],
    queryFn: ({ signal }) =>
      api.get<OverviewResponse>("/attendance/overview", { date, scope }, signal),
  });

  const rows = data?.rows ?? [];
  const missing = rows.filter((r) => r.record?.needsReview).length;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>
          {scope === "team" ? "My team" : "Everyone"}
          {missing > 0 ? (
            <Badge variant="secondary" className="bg-warning/12 text-warning ml-2">
              <AlertTriangle className="size-3" />
              {missing} need review
            </Badge>
          ) : null}
        </CardTitle>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous day"
            onClick={() => setDate((d) => shiftDate(d, -1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Input
            type="date"
            className="w-40"
            aria-label="Day"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next day"
            onClick={() => setDate((d) => shiftDate(d, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : error ? (
          <EmptyState
            title="Could not load attendance"
            description={error instanceof Error ? error.message : undefined}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nobody to show"
            description={
              scope === "team"
                ? "Nobody reports to you on this date."
                : "No employees were on the payroll on this date."
            }
          />
        ) : (
          <div className="bg-card overflow-x-auto rounded-xl border shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>In</TableHead>
                  <TableHead>Out</TableHead>
                  <TableHead>Worked</TableHead>
                  <TableHead>Late</TableHead>
                  <TableHead>Overtime</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ employee, record }) => (
                  <TableRow key={employee.id}>
                    <TableCell>
                      <span className="font-medium">
                        {fullName(employee.firstName, employee.lastName)}
                      </span>
                      <span className="text-muted-foreground block font-mono text-xs">
                        {employee.employeeCode}
                      </span>
                    </TableCell>
                    <TableCell>{employee.department ?? "—"}</TableCell>
                    <TableCell>
                      {record ? (
                        <div className="flex items-center gap-1.5">
                          <Badge variant="secondary" className={STATUS_TINT[record.status]}>
                            {STATUS_LABEL[record.status] ?? record.status}
                          </Badge>
                          {record.needsReview ? (
                            <AlertTriangle className="text-warning size-3.5" />
                          ) : null}
                        </div>
                      ) : (
                        // Not the same as absent, and saying so is the point.
                        <span className="text-muted-foreground text-xs">Not calculated</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{clock(record?.firstIn ?? null)}</TableCell>
                    <TableCell className="tabular-nums">{clock(record?.lastOut ?? null)}</TableCell>
                    <TableCell className="tabular-nums">
                      {record ? humanMinutes(record.workedMinutes) : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {record && record.lateMinutes > 0 ? humanMinutes(record.lateMinutes) : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {record && record.overtimeMinutes > 0
                        ? humanMinutes(record.overtimeMinutes)
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

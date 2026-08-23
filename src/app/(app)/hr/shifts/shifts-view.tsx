"use client";

import { Clock } from "lucide-react";
import { useState } from "react";

import { ManagedList } from "@/components/shared/managed-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { shiftDurationMinutes } from "@/modules/shifts/validators";

export interface Shift {
  id: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  halfDayThresholdMinutes: number;
  breakMinutes: number;
  weekOffDays: number[];
  isDefault: boolean;
  _count: { assignments: number };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** `480` → `8h 0m`, because minutes alone stop being readable past a couple of hours. */
function humanMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function isOvernight(shift: Shift): boolean {
  return shift.endTime <= shift.startTime;
}

export function ShiftsView({ canManage }: { canManage: boolean }) {
  return (
    <ManagedList<Shift>
      resource="shifts"
      queryKey={["shifts"]}
      singular="Shift"
      plural="Shifts"
      emptyIcon={Clock}
      emptyDescription="A shift defines working hours, grace time and week-offs. Attendance is measured against it."
      canManage={canManage}
      usageCount={(row) => row._count.assignments}
      rowLabel={(row) => row.name}
      columns={[
        {
          header: "Name",
          cell: (row) => (
            <div className="flex items-center gap-2">
              <span className="font-medium">{row.name}</span>
              {row.isDefault ? (
                <Badge variant="secondary" className="bg-brand-soft text-brand-soft-foreground">
                  Default
                </Badge>
              ) : null}
            </div>
          ),
        },
        { header: "Code", cell: (row) => <span className="font-mono text-xs">{row.code}</span> },
        {
          header: "Hours",
          cell: (row) => (
            <div className="flex items-center gap-2">
              <span className="tabular-nums">
                {row.startTime} – {row.endTime}
              </span>
              {isOvernight(row) ? (
                <Badge variant="outline" className="text-muted-foreground">
                  Overnight
                </Badge>
              ) : null}
            </div>
          ),
        },
        {
          header: "Worked",
          cell: (row) => (
            <span className="tabular-nums">
              {humanMinutes(shiftDurationMinutes(row.startTime, row.endTime, row.breakMinutes))}
            </span>
          ),
        },
        {
          header: "Week off",
          cell: (row) =>
            row.weekOffDays.length > 0 ? (
              row.weekOffDays.map((d) => DAYS[d]).join(", ")
            ) : (
              <span className="text-muted-foreground">None</span>
            ),
        },
        { header: "Assignments", cell: (row) => row._count.assignments },
      ]}
      renderForm={({ row, onSubmit, submitting, onCancel }) => (
        <ShiftForm
          key={row?.id ?? "new"}
          initial={row}
          submitting={submitting}
          onCancel={onCancel}
          onSubmit={onSubmit}
        />
      )}
    />
  );
}

function ShiftForm({
  initial,
  submitting,
  onCancel,
  onSubmit,
}: {
  initial: Shift | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "18:00");
  const [graceMinutes, setGraceMinutes] = useState(String(initial?.graceMinutes ?? 10));
  const [breakMinutes, setBreakMinutes] = useState(String(initial?.breakMinutes ?? 60));
  const [halfDay, setHalfDay] = useState(String(initial?.halfDayThresholdMinutes ?? 240));
  const [weekOffDays, setWeekOffDays] = useState<number[]>(initial?.weekOffDays ?? [0, 6]);
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [error, setError] = useState<string | null>(null);

  const worked = shiftDurationMinutes(startTime, endTime, Number(breakMinutes) || 0);
  const overnight = endTime <= startTime;

  function toggleDay(day: number) {
    setWeekOffDays((days) =>
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b),
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onSubmit({
        name,
        code,
        startTime,
        endTime,
        graceMinutes: Number(graceMinutes),
        breakMinutes: Number(breakMinutes),
        halfDayThresholdMinutes: Number(halfDay),
        weekOffDays,
        isDefault,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="shift-name">Name</Label>
          <Input
            id="shift-name"
            autoFocus
            required
            value={name}
            placeholder="General"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="shift-code">Code</Label>
          <Input
            id="shift-code"
            required
            value={code}
            placeholder="GEN"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="shift-start">Starts</Label>
          <Input
            id="shift-start"
            type="time"
            required
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="shift-end">Ends</Label>
          <Input
            id="shift-end"
            type="time"
            required
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
          />
        </div>
      </div>

      {/* Says out loud what an end time before the start time means, so an
          overnight shift never looks like a typo the user needs to fix. */}
      <p className="text-muted-foreground text-sm">
        {overnight ? "Runs overnight into the next day. " : null}
        Paid time works out to{" "}
        <span className="text-foreground font-medium">{humanMinutes(worked)}</span> after the break.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="shift-grace">Grace (min)</Label>
          <Input
            id="shift-grace"
            type="number"
            min={0}
            max={240}
            required
            value={graceMinutes}
            onChange={(event) => setGraceMinutes(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="shift-break">Break (min)</Label>
          <Input
            id="shift-break"
            type="number"
            min={0}
            max={480}
            required
            value={breakMinutes}
            onChange={(event) => setBreakMinutes(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="shift-halfday">Half-day under (min)</Label>
          <Input
            id="shift-halfday"
            type="number"
            min={1}
            max={1440}
            required
            value={halfDay}
            onChange={(event) => setHalfDay(event.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Week off</Label>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((label, day) => {
            const active = weekOffDays.includes(day);
            return (
              <Button
                key={label}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                aria-pressed={active}
                onClick={() => toggleDay(day)}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </div>

      <label className="flex items-start gap-2.5 text-sm">
        <Checkbox
          checked={isDefault}
          onCheckedChange={(checked) => setIsDefault(checked === true)}
        />
        <span>
          Make this the default shift
          <span className="text-muted-foreground block text-xs">
            New employees are measured against it until they are assigned another. Only one shift
            can be the default.
          </span>
        </span>
      </label>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {initial ? "Save changes" : "Add shift"}
        </Button>
      </DialogFooter>
    </form>
  );
}

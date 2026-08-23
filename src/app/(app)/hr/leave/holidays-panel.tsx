"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";

interface Holiday {
  id: string;
  name: string;
  holidayDate: string;
  isOptional: boolean;
  locationId: string | null;
  location: { id: string; name: string } | null;
}

interface Location {
  id: string;
  name: string;
}

/** The calendar attendance and leave both read from. */
export function HolidaysPanel({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [year, setYear] = useState(() => new Date().getUTCFullYear());
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["holidays", year],
    queryFn: ({ signal }) => api.get<Holiday[]>("/holidays", { year: String(year) }, signal),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/holidays/${id}`),
    onSuccess: () => {
      toast.success("Holiday removed");
      void queryClient.invalidateQueries({ queryKey: ["holidays"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not remove"),
  });

  const rows = data ?? [];

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Holidays</CardTitle>
          <CardDescription>
            Read by attendance and by leave day-counting, so a change here moves both.
          </CardDescription>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setYear((y) => y - 1)}>
            {year - 1}
          </Button>
          <span className="px-1 font-semibold tabular-nums">{year}</span>
          <Button variant="outline" size="sm" onClick={() => setYear((y) => y + 1)}>
            {year + 1}
          </Button>
          {canManage ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="size-4" />
              Add
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={`No holidays in ${year}`}
            description="Without a calendar, every working day counts as one — including the ones nobody works."
          />
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="w-28 font-medium tabular-nums">{row.holidayDate}</span>
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <Badge variant="outline" className="text-muted-foreground">
                  {row.location?.name ?? "Company-wide"}
                </Badge>
                {row.isOptional ? (
                  <Badge variant="secondary" className="bg-muted text-muted-foreground">
                    Optional
                  </Badge>
                ) : null}
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${row.name}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(row.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a holiday</DialogTitle>
          </DialogHeader>
          <HolidayForm
            year={year}
            onDone={() => {
              setOpen(false);
              void queryClient.invalidateQueries({ queryKey: ["holidays"] });
            }}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function HolidayForm({ year, onDone }: { year: number; onDone: () => void }) {
  const [name, setName] = useState("");
  const [holidayDate, setHolidayDate] = useState(`${year}-01-01`);
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const locations = useQuery({
    queryKey: ["org", "locations"],
    queryFn: ({ signal }) => api.get<Location[]>("/locations", undefined, signal),
  });

  const submit = useMutation({
    mutationFn: () =>
      api.post("/holidays", {
        name,
        holidayDate,
        // Blank means company-wide, which is the common case.
        locationId: locationId || null,
        isOptional: false,
      }),
    onSuccess: () => {
      toast.success("Holiday added");
      onDone();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not save"),
  });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        submit.mutate();
      }}
    >
      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="grid gap-2">
        <Label htmlFor="holiday-name">Name</Label>
        <Input
          id="holiday-name"
          required
          autoFocus
          value={name}
          placeholder="Republic Day"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="holiday-date">Date</Label>
        <Input
          id="holiday-date"
          type="date"
          required
          value={holidayDate}
          onChange={(e) => setHolidayDate(e.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="holiday-location">Applies to</Label>
        <Select value={locationId} onValueChange={(v) => setLocationId(v ?? "")}>
          <SelectTrigger id="holiday-location" className="w-full">
            <SelectValue placeholder="The whole company" />
          </SelectTrigger>
          <SelectContent>
            {(locations.data ?? []).map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name} only
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          A location still observes every company-wide holiday as well.
        </p>
      </div>

      <DialogFooter>
        <Button type="submit" disabled={submit.isPending}>
          {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Add holiday
        </Button>
      </DialogFooter>
    </form>
  );
}

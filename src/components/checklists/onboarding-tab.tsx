"use client";

import { Loader2, PlayCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ChecklistPanel } from "@/components/checklists/checklist-panel";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useChecklist, useStartChecklist, useTemplates } from "@/hooks/use-checklists";
import { useManagerOptions } from "@/hooks/use-employees";

/**
 * The onboarding tab on somebody's record.
 *
 * Two states, and the difference matters: a checklist not started is not the
 * same as one finished, and saying "0 of 0" for the first would be a lie
 * told with a progress bar.
 */

export function OnboardingTab({
  employeeId,
  employeeName,
  joinDate,
  canManage,
  today,
}: {
  employeeId: string;
  employeeName: string;
  joinDate: string | null;
  canManage: boolean;
  today: string;
}) {
  const checklist = useChecklist(employeeId, "onboarding");
  const [starting, setStarting] = useState(false);

  if (checklist.isLoading) return <Skeleton className="h-48 w-full" />;

  const tasks = checklist.data?.tasks ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>Onboarding</CardTitle>
          <CardDescription>
            Everything that has to happen before {employeeName} can be made active.
          </CardDescription>
        </div>
        {canManage && tasks.length === 0 ? (
          <Button size="sm" onClick={() => setStarting(true)}>
            <PlayCircle className="size-4" />
            Start onboarding
          </Button>
        ) : null}
      </CardHeader>

      <CardContent>
        {tasks.length === 0 ? (
          <EmptyState
            title="Not started"
            description={
              canManage
                ? "Pick a checklist and the tasks are dated from the join date and handed to the people who owe them."
                : "HR has not started a checklist for this person yet."
            }
          />
        ) : (
          <ChecklistPanel
            tasks={tasks}
            progress={checklist.data!.progress}
            today={today}
            canSettle={canManage}
          />
        )}
      </CardContent>

      <StartDialog
        employeeId={employeeId}
        employeeName={employeeName}
        joinDate={joinDate}
        open={starting}
        onOpenChange={setStarting}
      />
    </Card>
  );
}

function StartDialog({
  employeeId,
  employeeName,
  joinDate,
  open,
  onOpenChange,
}: {
  employeeId: string;
  employeeName: string;
  joinDate: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const templates = useTemplates("onboarding");
  const { data: people } = useManagerOptions();
  const start = useStartChecklist(employeeId);

  const [templateId, setTemplateId] = useState("");
  const [anchorDate, setAnchorDate] = useState(joinDate ?? "");
  const [itEmployeeId, setItEmployeeId] = useState("");

  const options = templates.data ?? [];
  const chosen = templateId || options.find((row) => row.isDefault)?.id || "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start onboarding for {employeeName}</DialogTitle>
          <DialogDescription>
            The tasks are copied from the checklist, so editing it later will not change this one.
          </DialogDescription>
        </DialogHeader>

        {templates.isLoading ? (
          <p className="text-muted-foreground text-sm">Loading checklists…</p>
        ) : options.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No onboarding checklist has been written yet. They are managed under HR → Onboarding.
          </p>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="start-template">Checklist</Label>
              <Select
                items={Object.fromEntries(options.map((row) => [row.id, row.name]))}
                value={chosen}
                onValueChange={(value) => setTemplateId(value ?? "")}
              >
                <SelectTrigger id="start-template" className="w-full">
                  <SelectValue placeholder="Choose a checklist" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.name}
                      {row.isDefault ? " · default" : ""} · {row._count.tasks} tasks
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="start-anchor">Count dates from</Label>
              <Input
                id="start-anchor"
                type="date"
                value={anchorDate}
                onChange={(event) => setAnchorDate(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Their join date, unless something has moved.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="start-it">Who handles IT tasks?</Label>
              <Select
                items={Object.fromEntries(
                  (people ?? []).map((person) => [
                    person.id,
                    [person.firstName, person.lastName].filter(Boolean).join(" "),
                  ]),
                )}
                value={itEmployeeId}
                onValueChange={(value) => setItEmployeeId(value ?? "")}
              >
                <SelectTrigger id="start-it" className="w-full">
                  <SelectValue placeholder="Nobody in particular" />
                </SelectTrigger>
                <SelectContent>
                  {(people ?? []).map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {[person.firstName, person.lastName].filter(Boolean).join(" ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Optional. Left empty, IT tasks still appear — they simply wait on the role rather
                than a person.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!chosen || start.isPending}
            onClick={() =>
              start.mutate(
                {
                  templateId: chosen,
                  anchorDate: anchorDate || null,
                  itEmployeeId: itEmployeeId || null,
                },
                {
                  onSuccess: () => {
                    toast.success("Onboarding started");
                    onOpenChange(false);
                  },
                  onError: (error: unknown) =>
                    toast.error(
                      error instanceof Error ? error.message : "Could not start onboarding",
                    ),
                },
              )
            }
          >
            {start.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Start it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

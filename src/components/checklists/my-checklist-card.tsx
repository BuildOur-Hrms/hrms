"use client";

import { ChecklistPanel } from "@/components/checklists/checklist-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMyChecklistTasks } from "@/hooks/use-checklists";

/**
 * The tasks somebody has been handed on a checklist.
 *
 * Renders nothing at all when there are none, which is the ordinary case for
 * everybody who is neither arriving nor leaving. A card saying "no tasks"
 * would be on every employee's home page forever to serve the fortnight when
 * it matters.
 */
export function MyChecklistCard({ today }: { today: string }) {
  const tasks = useMyChecklistTasks({ pendingOnly: true });
  const rows = tasks.data ?? [];

  if (tasks.isLoading || rows.length === 0) return null;

  const arriving = rows.some((task) => task.kind === "onboarding");

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{arriving ? "Getting you set up" : "Before you go"}</CardTitle>
        <CardDescription>
          {arriving
            ? "A few things to work through. Mark each one off as you do it."
            : "What is left to hand over and hand back."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/*
          No progress bar: this is the outstanding tasks, not the whole
          checklist, so any bar drawn from them would understate the work
          already done. The list is the answer here.
        */}
        <ChecklistPanel
          tasks={rows.map((task) => ({ ...task, completedAt: null, skipReason: null }))}
          today={today}
        />
      </CardContent>
    </Card>
  );
}

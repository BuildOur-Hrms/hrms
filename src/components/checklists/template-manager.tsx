"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  useDeleteTemplate,
  useSaveTemplate,
  useTemplate,
  useTemplates,
  type ChecklistAssignee,
  type TemplateTaskInput,
} from "@/hooks/use-checklists";

/**
 * Writing the checklists, for either direction.
 *
 * One component for both because the form is identical — a list of tasks,
 * each owed by somebody, each a number of days from an anchor. Only the
 * anchor differs, and that is a sentence of copy rather than a second screen.
 */

const ASSIGNEES: Record<ChecklistAssignee, string> = {
  hr: "HR",
  it: "IT",
  manager: "Their manager",
  employee: "The employee",
};

export function TemplateManager({
  kind,
  canManage,
}: {
  kind: "onboarding" | "offboarding";
  canManage: boolean;
}) {
  const templates = useTemplates(kind);
  const remove = useDeleteTemplate();
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (templates.isLoading) return <Skeleton className="h-64 w-full" />;
  const rows = templates.data ?? [];

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>Checklists</CardTitle>
          <CardDescription>
            Written once and reused. Tasks are dated from{" "}
            {kind === "onboarding" ? "each person’s join date" : "their last working day"} when the
            checklist is started.
          </CardDescription>
        </div>
        {canManage ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New checklist
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <EmptyState
            title="No checklists yet"
            description={
              kind === "onboarding"
                ? "Write one and it can be started against every new joiner."
                : "Write one and it starts as soon as a resignation is confirmed."
            }
          />
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{row.name}</span>
                  {row.isDefault ? (
                    <Badge variant="secondary" className="bg-brand-soft text-brand-soft-foreground">
                      Default
                    </Badge>
                  ) : null}
                </div>
                <p className="text-muted-foreground text-xs">
                  {row._count.tasks} task{row._count.tasks === 1 ? "" : "s"}
                  {row.description ? ` · ${row.description}` : ""}
                </p>
              </div>

              {canManage ? (
                <div className="flex gap-1">
                  <Button size="xs" variant="outline" onClick={() => setEditing(row.id)}>
                    Edit
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Archive ${row.name}`}
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate(row.id, {
                        onSuccess: () => toast.success("Checklist archived"),
                        onError: (error: unknown) =>
                          toast.error(
                            error instanceof Error ? error.message : "Could not archive it",
                          ),
                      })
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </CardContent>

      {creating ? (
        <TemplateDialog kind={kind} id={null} onClose={() => setCreating(false)} />
      ) : null}
      {editing ? (
        <TemplateDialog kind={kind} id={editing} onClose={() => setEditing(null)} />
      ) : null}
    </Card>
  );
}

const BLANK: TemplateTaskInput = {
  title: "",
  assignee: "hr",
  dueOffsetDays: 0,
  isRequired: true,
  sortOrder: 0,
};

function TemplateDialog({
  kind,
  id,
  onClose,
}: {
  kind: "onboarding" | "offboarding";
  id: string | null;
  onClose: () => void;
}) {
  const existing = useTemplate(id);
  const save = useSaveTemplate(id);

  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [tasks, setTasks] = useState<TemplateTaskInput[]>([{ ...BLANK }]);
  const [loaded, setLoaded] = useState(id === null);

  // Fill the form once the existing checklist arrives, and not again — the
  // form is the working copy from then on.
  if (id !== null && !loaded && existing.data) {
    setName(existing.data.name);
    setIsDefault(existing.data.isDefault);
    setTasks(existing.data.tasks.map((task) => ({ ...task })));
    setLoaded(true);
  }

  function update(index: number, patch: Partial<TemplateTaskInput>) {
    setTasks((current) =>
      current.map((task, position) => (position === index ? { ...task, ...patch } : task)),
    );
  }

  const valid = name.trim().length > 0 && tasks.every((task) => task.title.trim().length > 0);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{id ? "Edit checklist" : "New checklist"}</DialogTitle>
          <DialogDescription>
            Due dates are counted from{" "}
            {kind === "onboarding" ? "the join date" : "the last working day"}. A negative number
            lands before it —{" "}
            {kind === "onboarding"
              ? "a laptop wanted two days early is −2"
              : "a laptop wanted back the day before is −1"}
            .
          </DialogDescription>
        </DialogHeader>

        {!loaded ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="template-name">Name</Label>
              <Input
                id="template-name"
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                placeholder="Standard joiner"
              />
            </div>

            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox
                checked={isDefault}
                onCheckedChange={(checked) => setIsDefault(checked === true)}
              />
              <span>
                Use this one by default
                <span className="text-muted-foreground block text-xs">
                  Applied when nobody picks a different one. Only one checklist can be the default.
                </span>
              </span>
            </label>

            <div className="space-y-2">
              <Label>Tasks</Label>
              {tasks.map((task, index) => (
                <div key={index} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-12">
                  <div className="grid gap-1 sm:col-span-5">
                    <Label htmlFor={`task-title-${index}`} className="text-xs">
                      Title
                    </Label>
                    <Input
                      id={`task-title-${index}`}
                      value={task.title}
                      maxLength={160}
                      onChange={(event) => update(index, { title: event.target.value })}
                      placeholder="Laptop ready"
                    />
                  </div>

                  <div className="grid gap-1 sm:col-span-3">
                    <Label htmlFor={`task-who-${index}`} className="text-xs">
                      Who does it
                    </Label>
                    <Select
                      items={ASSIGNEES}
                      value={task.assignee}
                      onValueChange={(value) =>
                        update(index, { assignee: (value ?? "hr") as ChecklistAssignee })
                      }
                    >
                      <SelectTrigger id={`task-who-${index}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ASSIGNEES).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-1 sm:col-span-2">
                    <Label htmlFor={`task-due-${index}`} className="text-xs">
                      Days
                    </Label>
                    <Input
                      id={`task-due-${index}`}
                      type="number"
                      min={-365}
                      max={365}
                      value={task.dueOffsetDays}
                      onChange={(event) =>
                        update(index, { dueOffsetDays: Number(event.target.value) })
                      }
                    />
                  </div>

                  <div className="flex items-end justify-between gap-2 sm:col-span-2">
                    <label className="flex items-center gap-2 pb-2 text-xs">
                      <Checkbox
                        checked={task.isRequired}
                        onCheckedChange={(checked) =>
                          update(index, { isRequired: checked === true })
                        }
                      />
                      Required
                    </label>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove task ${index + 1}`}
                      disabled={tasks.length === 1}
                      onClick={() =>
                        setTasks((current) => current.filter((_, position) => position !== index))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}

              <Button
                size="sm"
                variant="outline"
                onClick={() => setTasks((current) => [...current, { ...BLANK }])}
              >
                <Plus className="size-4" />
                Add a task
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid || save.isPending}
            onClick={() =>
              save.mutate(
                {
                  kind,
                  name: name.trim(),
                  isDefault,
                  tasks: tasks.map((task, index) => ({ ...task, sortOrder: index + 1 })),
                },
                {
                  onSuccess: () => {
                    toast.success(id ? "Checklist saved" : "Checklist created");
                    onClose();
                  },
                  onError: (error: unknown) =>
                    toast.error(error instanceof Error ? error.message : "Could not save it"),
                },
              )
            }
          >
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

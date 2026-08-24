"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api-client";

/**
 * Checklists, from the browser's side.
 *
 * One key prefix for everything, because settling a task changes three
 * screens at once — the person's own list, the checklist it belongs to, and
 * HR's pipeline — and none of them should be left showing yesterday.
 */

export const checklistKeys = {
  all: ["checklists"] as const,
  templates: (kind?: string) => ["checklists", "templates", kind ?? "all"] as const,
  template: (id: string) => ["checklists", "template", id] as const,
  forEmployee: (id: string, kind: string) => ["checklists", "employee", id, kind] as const,
  tasks: (params: Record<string, unknown>) => ["checklists", "tasks", params] as const,
  pipeline: ["checklists", "pipeline"] as const,
};

export type ChecklistAssignee = "hr" | "it" | "manager" | "employee";
export type ChecklistTaskStatus = "pending" | "completed" | "skipped";

export interface ChecklistTask {
  id: string;
  title: string;
  description: string | null;
  assignee: ChecklistAssignee;
  dueDate: string | null;
  isRequired: boolean;
  status: ChecklistTaskStatus;
  completedAt: string | null;
  skipReason: string | null;
  assignedTo: { id: string; firstName: string; lastName: string | null } | null;
}

export interface ChecklistProgress {
  total: number;
  done: number;
  blocking: number;
  overdue: number;
  percent: number;
}

export interface Checklist {
  tasks: ChecklistTask[];
  progress: ChecklistProgress;
}

export interface TemplateSummary {
  id: string;
  kind: "onboarding" | "offboarding";
  name: string;
  description: string | null;
  isDefault: boolean;
  _count: { tasks: number };
}

export interface TemplateTaskInput {
  title: string;
  description?: string | null;
  assignee: ChecklistAssignee;
  dueOffsetDays: number;
  isRequired: boolean;
  sortOrder: number;
}

export interface TemplateDetail extends Omit<TemplateSummary, "_count"> {
  tasks: (TemplateTaskInput & { id: string })[];
}

export interface MyChecklistTask extends Omit<ChecklistTask, "completedAt" | "skipReason"> {
  kind: "onboarding" | "offboarding";
  employee: { id: string; firstName: string; lastName: string | null };
}

export interface PipelineRow {
  id: string;
  firstName: string;
  lastName: string | null;
  employeeCode: string;
  joinDate: string | null;
  designation: { title: string } | null;
  department: { name: string } | null;
  started: boolean;
  progress: ChecklistProgress;
}

export function useTemplates(kind?: "onboarding" | "offboarding") {
  return useQuery({
    queryKey: checklistKeys.templates(kind),
    queryFn: () => api.get<TemplateSummary[]>("/checklist-templates", kind ? { kind } : {}),
  });
}

export function useTemplate(id: string | null) {
  return useQuery({
    queryKey: checklistKeys.template(id ?? ""),
    queryFn: () => api.get<TemplateDetail>(`/checklist-templates/${id}`),
    enabled: id !== null,
  });
}

export function useSaveTemplate(id: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      id ? api.patch(`/checklist-templates/${id}`, body) : api.post("/checklist-templates", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: checklistKeys.all }),
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/checklist-templates/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: checklistKeys.all }),
  });
}

export function useChecklist(employeeId: string, kind: "onboarding" | "offboarding") {
  return useQuery({
    queryKey: checklistKeys.forEmployee(employeeId, kind),
    queryFn: () => api.get<Checklist>(`/employees/${employeeId}/${kind}`),
  });
}

export function useStartChecklist(employeeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post(`/employees/${employeeId}/onboarding`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: checklistKeys.all }),
  });
}

export function useSettleTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; status: string; skipReason?: string | null }) =>
      api.patch(`/checklist-tasks/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: checklistKeys.all }),
  });
}

export function useMyChecklistTasks(params: { pendingOnly?: boolean } = {}) {
  const query = { mine: "true", ...(params.pendingOnly ? { pendingOnly: "true" } : {}) };
  return useQuery({
    queryKey: checklistKeys.tasks(query),
    queryFn: () => api.get<MyChecklistTask[]>("/checklist-tasks", query),
  });
}

export function useOnboardingPipeline() {
  return useQuery({
    queryKey: checklistKeys.pipeline,
    queryFn: () => api.get<PipelineRow[]>("/onboarding/pipeline"),
  });
}

// ─────────────────────────────────────────────── leaving

export type ExitStatus =
  "initiated" | "in_progress" | "cleared" | "settled" | "completed" | "cancelled";

export interface ExitRequest {
  id: string;
  employeeId: string;
  reason: string;
  requestedLastWorkingDay: string;
  lastWorkingDay: string | null;
  status: ExitStatus;
  approvedAt: string | null;
  confirmedAt: string | null;
  clearedAt: string | null;
  settledAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  leaveEncashmentDays: string | number | null;
  settlementNotes: string | null;
  createdAt: string;
  employee: {
    id: string;
    firstName: string;
    lastName: string | null;
    employeeCode: string;
    managerId: string | null;
    designation: { title: string } | null;
    department: { name: string } | null;
  };
}

export const exitKeys = {
  all: ["offboarding"] as const,
  list: (status?: string) => ["offboarding", "list", status ?? "all"] as const,
  forEmployee: (id: string) => ["offboarding", "employee", id] as const,
};

export function useExits(status?: ExitStatus) {
  return useQuery({
    queryKey: exitKeys.list(status),
    queryFn: () => api.get<ExitRequest[]>("/offboarding", status ? { status } : {}),
  });
}

/**
 * The caller's own exits, and nobody else's.
 *
 * Separate from `useExits` because HR sees the whole company through that
 * one: a screen asking "have I resigned" was being handed the first exit in
 * the company and showing it as theirs.
 */
export function useMyExits() {
  return useQuery({
    queryKey: exitKeys.list("mine"),
    queryFn: () => api.get<ExitRequest[]>("/offboarding", { mine: "true" }),
  });
}

export function useEmployeeExit(employeeId: string) {
  return useQuery({
    queryKey: exitKeys.forEmployee(employeeId),
    queryFn: () =>
      api.get<{ request: ExitRequest | null } & Checklist>(`/employees/${employeeId}/offboarding`),
  });
}

/**
 * Every step of an exit, through one hook.
 *
 * The steps differ only in which endpoint they hit and what they carry, and
 * spelling out seven near-identical mutations would make the differences
 * harder to see rather than easier.
 */
export function useExitStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      step,
      body,
    }: {
      id: string;
      step: "approve" | "confirm" | "clear" | "settlement" | "complete" | "cancel";
      body?: Record<string, unknown>;
    }) => api.post(`/offboarding/${id}/${step}`, body ?? {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: exitKeys.all });
      void queryClient.invalidateQueries({ queryKey: checklistKeys.all });
      // The person's status changes with the exit, so their record is stale too.
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}

export function useResign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/offboarding", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: exitKeys.all }),
  });
}

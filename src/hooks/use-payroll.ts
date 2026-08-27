"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api-client";

/**
 * Payroll, from the browser's side.
 *
 * One key prefix, because approving a run changes three things at once — the
 * run's own status, the payslips it just wrote, and what the preview for that
 * month now means.
 *
 * Every money field crosses the network as a plain number of minor units.
 * `BigInt` does not survive JSON, so the service converts on the way out and
 * these types say so rather than pretending otherwise.
 */

export const payrollKeys = {
  all: ["payroll"] as const,
  components: () => ["payroll", "components"] as const,
  runs: (params: Record<string, unknown>) => ["payroll", "runs", params] as const,
  preview: (year: number, month: number) => ["payroll", "preview", year, month] as const,
  payslips: (params: Record<string, unknown>) => ["payroll", "payslips", params] as const,
  payslip: (id: string) => ["payroll", "payslip", id] as const,
};

export type RunStatus = "draft" | "approved" | "paid";
export type ComponentKind = "earning" | "deduction";
export type CalcType = "fixed" | "percentage";

export interface SalaryComponent {
  id: string;
  code: string;
  name: string;
  kind: ComponentKind;
  calcType: CalcType;
  prorates: boolean;
  sortOrder: number;
  baseComponent: { id: string; code: string } | null;
}

export interface PayrollRun {
  id: string;
  year: number;
  month: number;
  status: RunStatus;
  note: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  _count: { payslips: number };
}

export interface PreviewLine {
  code: string;
  name: string;
  kind: ComponentKind;
  amountMinor: number;
  sortOrder: number;
}

export interface PreviewRow {
  employee: { id: string; firstName: string; lastName: string | null; employeeCode: string };
  hasSalary: boolean;
  periodDays: number;
  lopDays: number;
  payableDays: number;
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
  lines: PreviewLine[];
}

export interface PayslipRow {
  id: string;
  periodDays: number;
  lopDays: number;
  payableDays: number;
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
  run: { id: string; year: number; month: number; status: RunStatus };
  employee: { id: string; firstName: string; lastName: string | null; employeeCode: string };
}

export interface PayslipDetail extends PayslipRow {
  employeeId: string;
  items: { id: string; code: string; name: string; kind: ComponentKind; amountMinor: number }[];
}

// ─────────────────────────────────────────────── reads

export function useSalaryComponents() {
  return useQuery({
    queryKey: payrollKeys.components(),
    queryFn: ({ signal }) => api.get<SalaryComponent[]>("/payroll/components", {}, signal),
  });
}

export function useRuns(params: { year?: number; status?: RunStatus } = {}) {
  return useQuery({
    queryKey: payrollKeys.runs(params),
    queryFn: ({ signal }) => api.get<PayrollRun[]>("/payroll/runs", params, signal),
  });
}

/**
 * The month worked out, without committing to it.
 *
 * `enabled` is the caller's, because this is the expensive read on the screen
 * — it gathers salaries, attendance and unpaid leave for everybody — and it
 * should not run until somebody has actually asked for a month.
 */
export function usePreview(year: number, month: number, enabled: boolean) {
  return useQuery({
    queryKey: payrollKeys.preview(year, month),
    // The endpoint answers `{ rows }` rather than a bare array — unwrapped
    // here so the screen holds a list like every other one does.
    queryFn: async ({ signal }) => {
      const result = await api.get<{ rows: PreviewRow[] }>(
        "/payroll/preview",
        { year, month },
        signal,
      );
      return result.rows;
    },
    enabled,
  });
}

export function usePayslips(params: { runId?: string; mine?: boolean } = {}) {
  return useQuery({
    queryKey: payrollKeys.payslips(params),
    queryFn: ({ signal }) =>
      api.get<PayslipRow[]>(
        "/payroll/payslips",
        {
          ...(params.runId ? { runId: params.runId } : {}),
          ...(params.mine ? { mine: "true" } : {}),
        },
        signal,
      ),
  });
}

export function usePayslip(id: string | null) {
  return useQuery({
    queryKey: payrollKeys.payslip(id ?? ""),
    queryFn: ({ signal }) => api.get<PayslipDetail>(`/payroll/payslips/${id}`, {}, signal),
    enabled: id !== null,
  });
}

// ─────────────────────────────────────────────── writes

function useInvalidatePayroll() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: payrollKeys.all });
}

export function useCreateRun() {
  const invalidate = useInvalidatePayroll();
  return useMutation({
    mutationFn: (input: { year: number; month: number; note?: string | null }) =>
      api.post<PayrollRun>("/payroll/runs", input),
    onSuccess: invalidate,
  });
}

export function useApproveRun() {
  const invalidate = useInvalidatePayroll();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ id: string; status: string; payslips: number }>(`/payroll/runs/${id}/approve`, {}),
    onSuccess: invalidate,
  });
}

export function useRunStatus() {
  const invalidate = useInvalidatePayroll();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "approved" | "paid" }) =>
      api.post(`/payroll/runs/${id}/status`, { status }),
    onSuccess: invalidate,
  });
}

export function useCreateComponent() {
  const invalidate = useInvalidatePayroll();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => api.post("/payroll/components", input),
    onSuccess: invalidate,
  });
}

export function useDeleteComponent() {
  const invalidate = useInvalidatePayroll();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/payroll/components/${id}`),
    onSuccess: invalidate,
  });
}

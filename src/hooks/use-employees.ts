"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type {
  CreateEmployeeInput,
  ListEmployeesInput,
  UpdateEmployeeInput,
} from "@/modules/employees/validators";

/**
 * Query keys follow `[module, resource, params]` so a mutation can invalidate
 * a whole module without knowing which filters are currently on screen.
 */
export const employeeKeys = {
  all: ["employees"] as const,
  list: (params: Partial<ListEmployeesInput>) => ["employees", "list", params] as const,
  detail: (id: string) => ["employees", "detail", id] as const,
  managerOptions: (exclude?: string) => ["employees", "manager-options", exclude ?? null] as const,
  orgOptions: ["employees", "org-options"] as const,
};

export interface EmployeeListItem {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string | null;
  workEmail: string | null;
  phone: string | null;
  status: string;
  employmentType: string;
  joinDate: string | null;
  department: { id: string; name: string } | null;
  designation: { id: string; title: string; level: number } | null;
  location: { id: string; name: string } | null;
  manager: { id: string; firstName: string; lastName: string | null } | null;
}

export interface OrgOptions {
  departments: { id: string; name: string; code: string }[];
  designations: { id: string; title: string; code: string; level: number }[];
  locations: { id: string; name: string; code: string }[];
  ready: boolean;
}

export function useEmployees(params: Partial<ListEmployeesInput>) {
  return useQuery({
    queryKey: employeeKeys.list(params),
    queryFn: ({ signal }) => api.list<EmployeeListItem>("/employees", params, signal),
    // Keep the current page on screen while the next one loads, so paging and
    // filtering do not flash an empty table.
    placeholderData: keepPreviousData,
  });
}

export function useEmployee(id: string) {
  return useQuery({
    queryKey: employeeKeys.detail(id),
    queryFn: ({ signal }) =>
      api.get<Record<string, unknown>>(`/employees/${id}`, undefined, signal),
    enabled: !!id,
  });
}

export function useOrgOptions() {
  return useQuery({
    queryKey: employeeKeys.orgOptions,
    queryFn: ({ signal }) => api.get<OrgOptions>("/org/options", undefined, signal),
    staleTime: 5 * 60_000,
  });
}

export function useManagerOptions(exclude?: string) {
  return useQuery({
    queryKey: employeeKeys.managerOptions(exclude),
    queryFn: ({ signal }) =>
      api.get<
        {
          id: string;
          firstName: string;
          lastName: string | null;
          employeeCode: string;
          designation: { title: string } | null;
        }[]
      >("/employees/manager-options", exclude ? { exclude } : undefined, signal),
    staleTime: 60_000,
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEmployeeInput) =>
      api.post<{ id: string; invite?: { inviteUrl?: string } }>("/employees", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: employeeKeys.all }),
  });
}

export function useUpdateEmployee(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateEmployeeInput) => api.patch(`/employees/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: employeeKeys.all }),
  });
}

export function useChangeEmployeeStatus(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { status: string; exitDate?: string | null; reason?: string | null }) =>
      api.post(`/employees/${id}/status`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: employeeKeys.all }),
  });
}

export function useInviteEmployee(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ userId: string; inviteUrl?: string }>(`/employees/${id}/invite`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: employeeKeys.all }),
  });
}

export function useDeleteEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/employees/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: employeeKeys.all }),
  });
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api-client";

/**
 * Performance, from the browser's side.
 *
 * One key prefix, because submitting half a review changes three screens at
 * once — the person's own, their manager's queue, and HR's matrix.
 */

export const performanceKeys = {
  all: ["performance"] as const,
  cycles: (status?: string) => ["performance", "cycles", status ?? "all"] as const,
  summary: (id: string) => ["performance", "summary", id] as const,
  goals: (cycleId: string, employeeId?: string) =>
    ["performance", "goals", cycleId, employeeId ?? "me"] as const,
  reviews: (params: Record<string, unknown>) => ["performance", "reviews", params] as const,
  review: (id: string) => ["performance", "review", id] as const,
};

export type CycleStatus = "draft" | "active" | "review" | "closed";
export type ReviewStatus = "pending_self" | "pending_manager" | "completed";

export interface Cycle {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  reviewDeadline: string | null;
  status: CycleStatus;
  _count?: { reviews: number };
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  weight: number;
  progress: number;
  status: string;
  dueDate: string | null;
  origin: "assigned" | "self";
  approvedAt: string | null;
}

export interface GoalSet {
  goals: Goal[];
  progress: number;
  approved: boolean;
}

export interface Review {
  id: string;
  cycleId: string;
  employeeId: string;
  managerId: string | null;
  status: ReviewStatus;
  selfRating: number | null;
  selfComments: string | null;
  selfSubmittedAt: string | null;
  managerRating: number | null;
  managerComments: string | null;
  managerSubmittedAt: string | null;
  finalRating: number | null;
  cycle: { id: string; name: string; status: CycleStatus; reviewDeadline: string | null };
  employee: {
    id: string;
    firstName: string;
    lastName: string | null;
    employeeCode: string;
    designation: { title: string } | null;
    department: { name: string } | null;
  };
}

export interface ReviewDetail extends Review, GoalSet {}

export interface CycleTally {
  total: number;
  awaitingSelf: number;
  awaitingManager: number;
  completed: number;
  rated: number;
  averageFinal: number | null;
  distribution: Record<string, number>;
}

export function useCycles(status?: CycleStatus) {
  return useQuery({
    queryKey: performanceKeys.cycles(status),
    queryFn: () => api.get<Cycle[]>("/performance/cycles", status ? { status } : {}),
  });
}

export function useCycleSummary(id: string | null) {
  return useQuery({
    queryKey: performanceKeys.summary(id ?? ""),
    queryFn: () =>
      api.get<{ cycle: Cycle; tally: CycleTally }>(`/performance/cycles/${id}/summary`),
    enabled: id !== null,
  });
}

export function useCreateCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/performance/cycles", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: performanceKeys.all }),
  });
}

export function useCycleStatus(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: CycleStatus) =>
      api.post<{ opened: number }>(`/performance/cycles/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: performanceKeys.all }),
  });
}

export function useGoals(cycleId: string | null, employeeId?: string) {
  return useQuery({
    queryKey: performanceKeys.goals(cycleId ?? "", employeeId),
    queryFn: () =>
      api.get<GoalSet>(`/performance/cycles/${cycleId}/goals`, employeeId ? { employeeId } : {}),
    enabled: cycleId !== null,
  });
}

export function useAddGoal(cycleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post(`/performance/cycles/${cycleId}/goals`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: performanceKeys.all }),
  });
}

export function useApproveGoals(cycleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (employeeId: string) =>
      api.post(`/performance/cycles/${cycleId}/goals/approve`, { employeeId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: performanceKeys.all }),
  });
}

export function useReviews(params: { mine?: boolean; toWrite?: boolean; cycleId?: string } = {}) {
  const query: Record<string, string> = {};
  if (params.mine) query["mine"] = "true";
  if (params.toWrite) query["toWrite"] = "true";
  if (params.cycleId) query["cycleId"] = params.cycleId;

  return useQuery({
    queryKey: performanceKeys.reviews(query),
    queryFn: () => api.get<Review[]>("/performance/reviews", query),
  });
}

export function useReview(id: string | null) {
  return useQuery({
    queryKey: performanceKeys.review(id ?? ""),
    queryFn: () => api.get<ReviewDetail>(`/performance/reviews/${id}`),
    enabled: id !== null,
  });
}

/**
 * Every way a review moves, through one hook.
 *
 * The steps differ only in which endpoint they hit; writing five near-identical
 * mutations would make the differences harder to see rather than easier.
 */
export function useReviewStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      step,
      body,
    }: {
      id: string;
      step: "self" | "manager" | "final" | "reopen";
      body: Record<string, unknown>;
    }) => api.post(`/performance/reviews/${id}/${step}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: performanceKeys.all }),
  });
}

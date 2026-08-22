"use client";

import { Loader2, Search, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { EmployeeStatusBadge, employmentTypeLabel } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEmployees, useOrgOptions } from "@/hooks/use-employees";
import type { ListEmployeesInput } from "@/modules/employees/validators";
import { fullName } from "@/lib/utils";

import { CreateEmployeeDialog } from "./create-employee-dialog";

const ALL = "__all__";

/** The status filter is either a real status or the "no filter" sentinel. */
type StatusFilter = NonNullable<ListEmployeesInput["status"]> | typeof ALL;

export function EmployeesTable({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>(ALL);
  const [departmentId, setDepartmentId] = useState<string>(ALL);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(canCreate && searchParams.get("new") === "1");

  // Debounced so typing a name does not fire a query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = useMemo(
    () => ({
      page,
      pageSize: 20,
      ...(debouncedSearch ? { q: debouncedSearch } : {}),
      ...(status !== ALL ? { status } : {}),
      ...(departmentId !== ALL ? { departmentId } : {}),
    }),
    [page, debouncedSearch, status, departmentId],
  );

  const { data, isLoading, isFetching, error } = useEmployees(params);
  const { data: orgOptions } = useOrgOptions();

  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 20));
  const hasFilters = !!debouncedSearch || status !== ALL || departmentId !== ALL;

  function closeCreate() {
    setCreateOpen(false);
    if (searchParams.get("new")) router.replace("/hr/employees");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, code or work email"
            className="pl-8"
            aria-label="Search employees"
          />
        </div>

        <Select
          value={status}
          onValueChange={(value) => {
            setStatus((value ?? ALL) as StatusFilter);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="onboarding">Onboarding</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="on_notice">On notice</SelectItem>
            <SelectItem value="exited">Exited</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={departmentId}
          onValueChange={(value) => {
            setDepartmentId(value ?? ALL);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-48" aria-label="Filter by department">
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments</SelectItem>
            {orgOptions?.departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus className="size-4" />
            Add employee
          </Button>
        ) : null}
      </div>

      {error ? (
        <EmptyState
          icon={Users}
          title="Could not load employees"
          description={error instanceof Error ? error.message : "Try refreshing the page."}
        />
      ) : isLoading ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 rounded-lg border py-16 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Loading employees
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={hasFilters ? "No employees match those filters" : "No employees yet"}
          description={
            hasFilters
              ? "Try clearing the search or filters."
              : "Add your first employee to get started."
          }
          action={
            canCreate && !hasFilters ? (
              <Button onClick={() => setCreateOpen(true)}>
                <UserPlus className="size-4" />
                Add employee
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell>
                      <Link
                        href={`/hr/employees/${employee.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {fullName(employee.firstName, employee.lastName)}
                      </Link>
                      {employee.workEmail ? (
                        <p className="text-muted-foreground text-xs">{employee.workEmail}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{employee.employeeCode}</TableCell>
                    <TableCell>{employee.department?.name ?? "—"}</TableCell>
                    <TableCell>{employee.designation?.title ?? "—"}</TableCell>
                    <TableCell>{employmentTypeLabel(employee.employmentType)}</TableCell>
                    <TableCell>
                      <EmployeeStatusBadge status={employee.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-sm">
              {total} employee{total === 1 ? "" : "s"}
              {isFetching ? " · updating…" : ""}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="text-muted-foreground text-sm">
                Page {page} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {canCreate ? <CreateEmployeeDialog open={createOpen} onClose={closeCreate} /> : null}
    </div>
  );
}

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FileClock } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { TableSkeleton } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { api } from "@/lib/api-client";
import { fullName } from "@/lib/utils";

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
  actor: {
    id: string;
    email: string;
    employee: { firstName: string; lastName: string | null } | null;
  } | null;
}

const ALL = "__all__";

/** Base UI reads the trigger's label from here; without it the raw value shows. */
const ENTITY_ITEMS: Record<string, string> = {
  [ALL]: "All entities",
  user: "user",
  employee: "employee",
  department: "department",
  designation: "designation",
  location: "location",
  company: "company",
  system_setting: "system setting",
};

const ENTITY_TYPES = [
  "user",
  "employee",
  "department",
  "designation",
  "location",
  "company",
  "system_setting",
];

export function AuditViewer() {
  const [entityType, setEntityType] = useState(ALL);
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const params = useMemo(
    () => ({
      page,
      pageSize: 25,
      ...(entityType !== ALL ? { entityType } : {}),
      ...(action ? { action } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }),
    [page, entityType, action, from, to],
  );

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["audit", params],
    queryFn: ({ signal }) => api.list<AuditRow>("/audit-logs", params, signal),
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor="entityType">Entity</Label>
          <Select
            items={ENTITY_ITEMS}
            value={entityType}
            onValueChange={(value) => {
              setEntityType(value ?? ALL);
              setPage(1);
            }}
          >
            <SelectTrigger id="entityType">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All entities</SelectItem>
              {ENTITY_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="action">Action starts with</Label>
          <Input
            id="action"
            value={action}
            placeholder="employee."
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="from">From</Label>
          <Input
            id="from"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="to">To</Label>
          <Input
            id="to"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {error ? (
        <EmptyState
          icon={FileClock}
          title="Could not load the audit log"
          description={error instanceof Error ? error.message : undefined}
        />
      ) : isLoading ? (
        <TableSkeleton rows={10} columns={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileClock}
          title="Nothing recorded for these filters"
          description="Audit entries are written as people act in the system."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead className="w-24">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow>
                      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                        {new Date(row.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-[11px] font-normal">
                          {row.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.actor ? (
                          <>
                            <span className="font-medium">
                              {row.actor.employee
                                ? fullName(
                                    row.actor.employee.firstName,
                                    row.actor.employee.lastName,
                                  )
                                : row.actor.email}
                            </span>
                            {row.ip ? (
                              <span className="text-muted-foreground block text-xs">{row.ip}</span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-muted-foreground">System</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.entityType.replace(/_/g, " ")}
                        {row.entityId ? (
                          <span className="text-muted-foreground block font-mono text-[11px]">
                            {row.entityId.slice(0, 8)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {row.before || row.after ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                          >
                            {expanded === row.id ? "Hide" : "Show"}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-xs">&mdash;</span>
                        )}
                      </TableCell>
                    </TableRow>

                    {expanded === row.id ? (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/40">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <DiffBlock label="Before" value={row.before} />
                            <DiffBlock label="After" value={row.after} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-sm">
              {total} entries{isFetching ? " · updating…" : ""}
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
    </div>
  );
}

function DiffBlock({ label, value }: { label: string; value: unknown }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">{label}</p>
      <pre className="bg-background overflow-x-auto rounded-md border p-2 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

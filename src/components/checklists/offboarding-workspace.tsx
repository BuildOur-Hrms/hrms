"use client";

import { TemplateManager } from "@/components/checklists/template-manager";
import { ButtonLink } from "@/components/shared/button-link";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useExits, type ExitStatus } from "@/hooks/use-checklists";

/**
 * Leaving, from HR's side.
 *
 * The mirror of the onboarding workspace, and deliberately the same shape:
 * who is on the way out, and the checklists they follow. Somebody who has
 * learned one screen has learned both.
 */

const STATUS_LABEL: Record<ExitStatus, string> = {
  initiated: "Awaiting approval",
  in_progress: "On notice",
  cleared: "Cleared",
  settled: "Settled",
  completed: "Left",
  cancelled: "Withdrawn",
};

const STATUS_TINT: Record<ExitStatus, string> = {
  initiated: "bg-warning/12 text-warning",
  in_progress: "bg-info/12 text-info",
  cleared: "bg-info/12 text-info",
  settled: "bg-info/12 text-info",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

export function OffboardingWorkspace({ canManage }: { canManage: boolean }) {
  return (
    <Tabs defaultValue="leaving">
      <TabsList>
        <TabsTrigger value="leaving">Leaving</TabsTrigger>
        <TabsTrigger value="templates">Checklists</TabsTrigger>
      </TabsList>

      <TabsContent value="leaving" className="mt-4">
        <Leaving />
      </TabsContent>

      <TabsContent value="templates" className="mt-4">
        <TemplateManager kind="offboarding" canManage={canManage} />
      </TabsContent>
    </Tabs>
  );
}

function Leaving() {
  const exits = useExits();

  if (exits.isLoading) return <Skeleton className="h-64 w-full" />;
  const rows = exits.data ?? [];

  // Finished and withdrawn exits stay in the list, at the bottom: "did anybody
  // ever action that resignation" is a question people ask months later.
  const open = rows.filter((row) => !["completed", "cancelled"].includes(row.status));
  const closed = rows.filter((row) => ["completed", "cancelled"].includes(row.status));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leaving</CardTitle>
        <CardDescription>
          Resignations in progress. Each one moves in order — approved, confirmed, cleared, settled,
          closed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            title="Nobody is leaving"
            description="Resignations appear here as they are filed."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Last day</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...open, ...closed].map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <span className="font-medium">
                        {[row.employee.firstName, row.employee.lastName].filter(Boolean).join(" ")}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {row.employee.designation?.title ?? "—"}
                        {row.employee.department ? ` · ${row.employee.department.name}` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {row.lastWorkingDay
                        ? row.lastWorkingDay.slice(0, 10)
                        : `${row.requestedLastWorkingDay.slice(0, 10)} (asked)`}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={STATUS_TINT[row.status]}>
                        {STATUS_LABEL[row.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <ButtonLink
                        href={`/hr/employees/${row.employee.id}`}
                        variant="ghost"
                        size="sm"
                        aria-label={`Open ${row.employee.firstName}`}
                      >
                        Open
                      </ButtonLink>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

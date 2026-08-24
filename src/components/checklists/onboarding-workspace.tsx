"use client";

import { ProgressBar } from "@/components/checklists/checklist-panel";
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
import { useOnboardingPipeline } from "@/hooks/use-checklists";

/**
 * Onboarding, from HR's side: who is arriving, and the checklists they follow.
 *
 * Two tabs rather than two pages, because the pipeline is what HR opens and
 * the templates are what they set up once — putting them behind separate
 * navigation would make the rare thing as prominent as the daily one.
 */

export function OnboardingWorkspace({ canManage, today }: { canManage: boolean; today: string }) {
  return (
    <Tabs defaultValue="pipeline">
      <TabsList>
        <TabsTrigger value="pipeline">Arriving</TabsTrigger>
        <TabsTrigger value="templates">Checklists</TabsTrigger>
      </TabsList>

      <TabsContent value="pipeline" className="mt-4">
        <Pipeline today={today} />
      </TabsContent>

      <TabsContent value="templates" className="mt-4">
        <TemplateManager kind="onboarding" canManage={canManage} />
      </TabsContent>
    </Tabs>
  );
}

function Pipeline({ today }: { today: string }) {
  const pipeline = useOnboardingPipeline();

  if (pipeline.isLoading) return <Skeleton className="h-64 w-full" />;
  const rows = pipeline.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Still arriving</CardTitle>
        <CardDescription>
          Everybody whose record is set to onboarding. They become active once the required tasks
          are settled.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            title="Nobody is onboarding"
            description="People appear here while their record is set to onboarding."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Joins</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <span className="font-medium">
                        {[row.firstName, row.lastName].filter(Boolean).join(" ")}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {row.designation?.title ?? "—"}
                        {row.department ? ` · ${row.department.name}` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {row.joinDate ? row.joinDate.slice(0, 10) : "—"}
                    </TableCell>
                    <TableCell>
                      {row.started ? (
                        <ProgressBar progress={row.progress} />
                      ) : (
                        // Not the same as a finished checklist, and a full bar
                        // here would say the opposite of what is true.
                        <Badge variant="secondary" className="bg-warning/12 text-warning">
                          Not started
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <ButtonLink
                        href={`/hr/employees/${row.id}`}
                        variant="ghost"
                        size="sm"
                        aria-label={`Open ${row.firstName}`}
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
        <p className="text-muted-foreground mt-3 text-xs">Overdue is measured against {today}.</p>
      </CardContent>
    </Card>
  );
}

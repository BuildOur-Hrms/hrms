"use client";

import { ComponentsTab } from "@/components/payroll/components-tab";
import { PreviewTab } from "@/components/payroll/preview-tab";
import { RunsTab } from "@/components/payroll/runs-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Payroll, from HR's side.
 *
 * Three tabs in the order the work happens: check the month, run it, and —
 * rarely — change what a salary is made of. Components come last because
 * they are set up once and then left alone, and putting them first would
 * suggest otherwise.
 */
export function PayrollWorkspace({
  canManage,
  canApprove,
}: {
  canManage: boolean;
  canApprove: boolean;
}) {
  return (
    <Tabs defaultValue="runs">
      <TabsList>
        <TabsTrigger value="runs">Runs</TabsTrigger>
        <TabsTrigger value="preview">Preview</TabsTrigger>
        <TabsTrigger value="components">Components</TabsTrigger>
      </TabsList>

      <TabsContent value="runs" className="mt-4">
        <RunsTab canManage={canManage} canApprove={canApprove} />
      </TabsContent>
      <TabsContent value="preview" className="mt-4">
        <PreviewTab />
      </TabsContent>
      <TabsContent value="components" className="mt-4">
        <ComponentsTab canManage={canManage} />
      </TabsContent>
    </Tabs>
  );
}

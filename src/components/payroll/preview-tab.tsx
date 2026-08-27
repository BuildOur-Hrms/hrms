"use client";

import { AlertTriangle, Calculator } from "lucide-react";
import { useState } from "react";

import { employeeName, periodLabel, recentPeriods } from "@/components/payroll/parts";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePreview } from "@/hooks/use-payroll";
import { formatMinor } from "@/lib/money";

/**
 * The month worked out, before anybody commits to it.
 *
 * This is the screen that exists so nobody approves a run to find out what it
 * says. It is computed from the same code the approval uses, so what is shown
 * here is what will be written — the only difference is that nothing is
 * stored.
 *
 * Loaded on request rather than on arrival: it gathers salaries, attendance
 * and unpaid leave for everybody, and nobody wants that to happen because
 * they clicked a tab.
 */

export function PreviewTab() {
  const periods = recentPeriods();
  const first = periods[0]!;
  const [period, setPeriod] = useState(`${first.year}-${first.month}`);

  /*
   * Base UI resolves the trigger's label from this map, not from the items in
   * the popup — which is not mounted until somebody opens it. Without it the
   * trigger reads "2026-8" instead of "August 2026".
   */
  const periodItems: Record<string, string> = Object.fromEntries(
    periods.map((p) => [`${p.year}-${p.month}`, periodLabel(p.year, p.month)]),
  );
  const [asked, setAsked] = useState<{ year: number; month: number } | null>(null);

  const preview = usePreview(asked?.year ?? 0, asked?.month ?? 0, asked !== null);
  const rows = preview.data ?? [];

  const unpaidable = rows.filter((row) => !row.hasSalary);
  const totals = rows.reduce(
    (acc, row) => ({
      gross: acc.gross + row.grossMinor,
      deductions: acc.deductions + row.deductionsMinor,
      net: acc.net + row.netMinor,
    }),
    { gross: 0, deductions: 0, net: 0 },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preview a month</CardTitle>
        <CardDescription>
          What each person would be paid, worked out by the same code that writes the payslips.
          Nothing here is stored.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-2">
            <Label htmlFor="preview-period">Month</Label>
            <Select
              items={periodItems}
              value={period}
              onValueChange={(value) => setPeriod(value ?? period)}
            >
              <SelectTrigger id="preview-period" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`}>
                    {periodLabel(p.year, p.month)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => {
              const [year, month] = period.split("-").map(Number);
              setAsked({ year: year!, month: month! });
            }}
          >
            <Calculator className="size-4" />
            Work it out
          </Button>
        </div>

        {asked === null ? (
          <EmptyState
            icon={Calculator}
            title="Pick a month"
            description="Nothing is calculated until you ask for it — this reads attendance and leave for everybody."
          />
        ) : preview.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : preview.isError ? (
          <EmptyState
            title="Could not work out that month"
            description="Something went wrong. Try again in a moment."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nobody to pay"
            description="No active employees fell inside this month."
          />
        ) : (
          <>
            {unpaidable.length > 0 ? (
              /*
               * Said out loud, at the top, because these people are the whole
               * risk in a payroll run. They are listed in the table with zeros
               * rather than left out — a missing person is how a payroll
               * quietly underpays — but a row of zeros is easy to scroll past.
               */
              <Alert>
                <AlertTriangle className="size-4" />
                <AlertDescription>
                  {unpaidable.length} {unpaidable.length === 1 ? "person has" : "people have"} no
                  salary on record and would be paid nothing:{" "}
                  {unpaidable.map((row) => employeeName(row.employee)).join(", ")}.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-3">
              <Total label="Gross" value={totals.gross} />
              <Total label="Deductions" value={totals.deductions} />
              <Total label="Net" value={totals.net} emphasis />
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Payable days</TableHead>
                  <TableHead className="text-right">Loss of pay</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.employee.id}>
                    <TableCell>
                      <div className="font-medium">{employeeName(row.employee)}</div>
                      <div className="text-muted-foreground font-mono text-xs">
                        {row.employee.employeeCode}
                      </div>
                      {!row.hasSalary ? (
                        <Badge variant="secondary" className="mt-1">
                          No salary on record
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.payableDays} / {row.periodDays}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.lopDays > 0 ? row.lopDays : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMinor(row.grossMinor)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMinor(row.deductionsMinor)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMinor(row.netMinor)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Total({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="bg-card rounded-xl border p-4 shadow-xs">
      <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        {label}
      </p>
      <p className={`mt-1 tabular-nums ${emphasis ? "text-2xl font-semibold" : "text-xl"}`}>
        {formatMinor(value)}
      </p>
    </div>
  );
}

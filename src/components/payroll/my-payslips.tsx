"use client";

import { FileText } from "lucide-react";
import { useState } from "react";

import { employeeName, periodLabel, RUN_LABEL, RUN_TINT } from "@/components/payroll/parts";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePayslip, usePayslips } from "@/hooks/use-payroll";
import { formatMinor } from "@/lib/money";

/**
 * Your own payslips.
 *
 * A list of months and, behind each, the breakdown — because "why is this
 * month different" is the only question anybody opens a payslip to answer,
 * and a net figure on its own cannot answer it.
 */
export function MyPayslips() {
  const payslips = usePayslips({ mine: true });
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = payslips.data ?? [];

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Payslips</CardTitle>
          <CardDescription>
            One for every month that has been approved. Open one to see what made it up.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {payslips.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : payslips.isError ? (
            <EmptyState
              title="Could not load your payslips"
              description="Something went wrong fetching them. Try again in a moment."
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No payslips yet"
              description="One appears here for each month your company approves payroll for."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Payable days</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((payslip) => (
                  <TableRow key={payslip.id}>
                    <TableCell>
                      <Button
                        variant="link"
                        className="h-auto p-0 font-medium"
                        onClick={() => setOpenId(payslip.id)}
                      >
                        {periodLabel(payslip.run.year, payslip.run.month)}
                      </Button>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {payslip.payableDays} / {payslip.periodDays}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMinor(payslip.grossMinor)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMinor(payslip.deductionsMinor)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMinor(payslip.netMinor)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge className={RUN_TINT[payslip.run.status]} variant="secondary">
                        {RUN_LABEL[payslip.run.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PayslipDialog id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

export function PayslipDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const payslip = usePayslip(id);
  const data = payslip.data;

  const earnings = data?.items.filter((item) => item.kind === "earning") ?? [];
  const deductions = data?.items.filter((item) => item.kind === "deduction") ?? [];

  return (
    <Dialog open={id !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{data ? periodLabel(data.run.year, data.run.month) : "Payslip"}</DialogTitle>
          <DialogDescription>
            {data
              ? `${employeeName(data.employee)} · ${data.payableDays} of ${data.periodDays} days paid`
              : "Loading the breakdown."}
          </DialogDescription>
        </DialogHeader>

        {payslip.isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : payslip.isError || !data ? (
          <EmptyState
            title="Could not load this payslip"
            description="Something went wrong fetching it. Try again in a moment."
          />
        ) : (
          <div className="space-y-4">
            <Section title="Earnings" items={earnings} />
            {deductions.length > 0 ? <Section title="Deductions" items={deductions} /> : null}

            {data.lopDays > 0 ? (
              <p className="text-muted-foreground text-sm">
                {data.lopDays} {data.lopDays === 1 ? "day" : "days"} of loss of pay reduced the
                amounts that prorate.
              </p>
            ) : null}

            <div className="flex items-center justify-between border-t pt-3">
              <span className="font-medium">Net pay</span>
              <span className="text-xl font-semibold tabular-nums">
                {formatMinor(data.netMinor)}
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  items,
}: {
  title: string;
  items: { id: string; code: string; name: string; amountMinor: number }[];
}) {
  const total = items.reduce((sum, item) => sum + item.amountMinor, 0);

  return (
    <div>
      <p className="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wider uppercase">
        {title}
      </p>
      <dl className="space-y-1">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between text-sm">
            <dt>
              {item.name}
              <span className="text-muted-foreground ml-1.5 font-mono text-xs">{item.code}</span>
            </dt>
            <dd className="tabular-nums">{formatMinor(item.amountMinor)}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between border-t pt-1 text-sm font-medium">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMinor(total)}</dd>
        </div>
      </dl>
    </div>
  );
}

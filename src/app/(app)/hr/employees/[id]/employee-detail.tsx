"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, ShieldAlert, Trash2, UserCog } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import {
  EmployeeStatusBadge,
  UserStatusBadge,
  employmentTypeLabel,
} from "@/components/shared/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  employeeKeys,
  useChangeEmployeeStatus,
  useDeleteEmployee,
  useEmployee,
  useInviteEmployee,
} from "@/hooks/use-employees";
import { ApiError } from "@/lib/api-client";
import { fullName, initials } from "@/lib/utils";

interface EmployeeDetailData {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string | null;
  workEmail: string | null;
  personalEmail?: string | null;
  phone: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  address?: string | null;
  status: string;
  employmentType: string;
  joinDate: string | null;
  probationEndDate?: string | null;
  confirmationDate?: string | null;
  exitDate?: string | null;
  noticePeriodDays?: number | null;
  department: { id: string; name: string } | null;
  designation: { id: string; title: string; level: number } | null;
  location: { id: string; name: string } | null;
  manager: { id: string; firstName: string; lastName: string | null } | null;
  user?: { id: string; email: string; status: string; lastLoginAt: string | null } | null;
  emergencyContacts: {
    id: string;
    name: string;
    relationship: string;
    phone: string;
    isPrimary: boolean;
  }[];
  directReports: { id: string; firstName: string; lastName: string | null; employeeCode: string }[];
}

/** Which statuses can follow the current one — mirrors the server state machine. */
const NEXT_STATUSES: Record<string, string[]> = {
  onboarding: ["active", "exited"],
  active: ["on_notice", "exited"],
  on_notice: ["active", "exited"],
  exited: [],
};

const STATUS_LABELS: Record<string, string> = {
  onboarding: "Onboarding",
  active: "Active",
  on_notice: "On notice",
  exited: "Exited",
};

export function EmployeeDetail({
  id,
  canEdit,
  canDelete,
  canInvite,
}: {
  id: string;
  canEdit: boolean;
  canDelete: boolean;
  canInvite: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useEmployee(id);

  const [statusOpen, setStatusOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const employee = data as unknown as EmployeeDetailData | undefined;
  const invite = useInviteEmployee(id);
  const remove = useDeleteEmployee();

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 rounded-lg border py-16 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading
      </div>
    );
  }

  if (error || !employee) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Employee not found"
        description={
          error instanceof ApiError && error.status === 404
            ? "This record does not exist, or it is outside what you can see."
            : "Something went wrong loading this record."
        }
      />
    );
  }

  const name = fullName(employee.firstName, employee.lastName);
  const canSeePersonal = "personalEmail" in employee;

  async function sendInvite() {
    try {
      const result = await invite.mutateAsync();
      toast.success("Invite sent", {
        description: result.inviteUrl
          ? "Email is in console mode — the link is in the server log."
          : "They will receive an email with a link to set their password.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the invite");
    }
  }

  async function confirmDelete() {
    try {
      await remove.mutateAsync(id);
      toast.success(`${name} removed`);
      router.push("/hr/employees");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete this record");
      setDeleteOpen(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar className="size-12">
            <AvatarFallback>{initials(employee.firstName, employee.lastName)}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
            <p className="text-muted-foreground text-sm">
              <span className="font-mono">{employee.employeeCode}</span>
              {employee.designation ? ` · ${employee.designation.title}` : ""}
              {employee.department ? ` · ${employee.department.name}` : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <EmployeeStatusBadge status={employee.status} />
          {canEdit && NEXT_STATUSES[employee.status]!.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setStatusOpen(true)}>
              <UserCog className="size-4" />
              Change status
            </Button>
          ) : null}
          {canInvite && !employee.user && employee.status !== "exited" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void sendInvite()}
              disabled={invite.isPending}
            >
              {invite.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Mail className="size-4" />
              )}
              Send invite
            </Button>
          ) : null}
          {canDelete ? (
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="size-4" />
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="employment">Employment</TabsTrigger>
          {canSeePersonal ? <TabsTrigger value="contacts">Emergency contacts</TabsTrigger> : null}
          {employee.user !== undefined ? <TabsTrigger value="account">Account</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <Detail label="Work email" value={employee.workEmail} />
              <Detail label="Phone" value={employee.phone} />
              {canSeePersonal ? (
                <>
                  <Detail label="Personal email" value={employee.personalEmail} />
                  <Detail label="Date of birth" value={employee.dateOfBirth} />
                  <Detail label="Address" value={employee.address} className="sm:col-span-2" />
                </>
              ) : (
                <p className="text-muted-foreground text-sm sm:col-span-2">
                  Personal contact details are visible to the employee and HR only.
                </p>
              )}
            </CardContent>
          </Card>

          {employee.directReports.length > 0 ? (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Direct reports ({employee.directReports.length})</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {employee.directReports.map((report) => (
                  <Badge key={report.id} variant="secondary">
                    {fullName(report.firstName, report.lastName)}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="employment" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Employment</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <Detail label="Department" value={employee.department?.name} />
              <Detail label="Designation" value={employee.designation?.title} />
              <Detail label="Location" value={employee.location?.name} />
              <Detail
                label="Reports to"
                value={
                  employee.manager
                    ? fullName(employee.manager.firstName, employee.manager.lastName)
                    : null
                }
              />
              <Detail
                label="Employment type"
                value={employmentTypeLabel(employee.employmentType)}
              />
              <Detail label="Join date" value={employee.joinDate} />
              <Detail label="Probation ends" value={employee.probationEndDate} />
              <Detail label="Confirmed on" value={employee.confirmationDate} />
              {employee.exitDate ? <Detail label="Exit date" value={employee.exitDate} /> : null}
              <Detail
                label="Notice period"
                value={employee.noticePeriodDays ? `${employee.noticePeriodDays} days` : null}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {canSeePersonal ? (
          <TabsContent value="contacts" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Emergency contacts</CardTitle>
              </CardHeader>
              <CardContent>
                {employee.emergencyContacts.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No emergency contacts recorded.</p>
                ) : (
                  <div className="divide-y">
                    {employee.emergencyContacts.map((contact) => (
                      <div key={contact.id} className="flex items-center justify-between py-3">
                        <div>
                          <p className="font-medium">
                            {contact.name}
                            {contact.isPrimary ? (
                              <Badge variant="secondary" className="ml-2">
                                Primary
                              </Badge>
                            ) : null}
                          </p>
                          <p className="text-muted-foreground text-sm">
                            {contact.relationship} · {contact.phone}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        {employee.user !== undefined ? (
          <TabsContent value="account" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Login account</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {employee.user ? (
                  <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                    <Detail label="Email" value={employee.user.email} />
                    <div>
                      <p className="text-muted-foreground text-sm">Status</p>
                      <div className="mt-1">
                        <UserStatusBadge status={employee.user.status} />
                      </div>
                    </div>
                    <Detail
                      label="Last signed in"
                      value={
                        employee.user.lastLoginAt
                          ? new Date(employee.user.lastLoginAt).toLocaleString()
                          : "Never"
                      }
                    />
                  </div>
                ) : (
                  <Alert>
                    <AlertDescription>
                      This person has no login account yet.
                      {employee.workEmail
                        ? " Send them an invite to create one."
                        : " Add a work email first, then send an invite."}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>

      <StatusDialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        employeeId={id}
        currentStatus={employee.status}
        onChanged={() => queryClient.invalidateQueries({ queryKey: employeeKeys.detail(id) })}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {name}?</DialogTitle>
            <DialogDescription>
              The record is archived rather than erased, so history and audit trails stay intact. It
              disappears from lists and reports.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={remove.isPending}
            >
              {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusDialog({
  open,
  onClose,
  employeeId,
  currentStatus,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  employeeId: string;
  currentStatus: string;
  onChanged: () => void;
}) {
  const options = NEXT_STATUSES[currentStatus] ?? [];
  const [status, setStatus] = useState(options[0] ?? "");
  const [exitDate, setExitDate] = useState(new Date().toISOString().slice(0, 10));
  const change = useChangeEmployeeStatus(employeeId);

  async function submit() {
    try {
      await change.mutateAsync({
        status,
        ...(status === "exited" ? { exitDate } : {}),
      });
      toast.success(`Status changed to ${STATUS_LABELS[status] ?? status}`);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the status");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change status</DialogTitle>
          <DialogDescription>
            Currently {STATUS_LABELS[currentStatus] ?? currentStatus}. Marking someone as exited
            also disables their login immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>New status</Label>
            <Select value={status} onValueChange={(value) => setStatus(value ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {STATUS_LABELS[option] ?? option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {status === "exited" ? (
            <>
              <Separator />
              <div className="grid gap-2">
                <Label htmlFor="exitDate">Last working day</Label>
                <Input
                  id="exitDate"
                  type="date"
                  value={exitDate}
                  onChange={(event) => setExitDate(event.target.value)}
                />
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!status || change.isPending}>
            {change.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Detail({
  label,
  value,
  className,
}: {
  label: string;
  value?: string | null;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-0.5 break-words">{value || "—"}</p>
    </div>
  );
}

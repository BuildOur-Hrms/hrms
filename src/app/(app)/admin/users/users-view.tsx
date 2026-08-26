"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IdCard,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
  Trash2,
  Unlock,
  UserPlus,
  UserX,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { UserStatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

import { CreateEmployeeDialog } from "../../hr/employees/create-employee-dialog";
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
import { api } from "@/lib/api-client";
import { fullName } from "@/lib/utils";

interface Role {
  id: string;
  name: string;
}

interface AppUser {
  id: string;
  email: string;
  status: "invited" | "active" | "disabled";
  lastLoginAt: string | null;
  isLocked: boolean;
  employee: {
    id: string;
    firstName: string;
    lastName: string | null;
    employeeCode: string;
  } | null;
  roles: Role[];
}

/** `hr_admin` reads badly in a table; people call it HR admin. */
function roleLabel(name: string): string {
  return name.replace(/_/g, " ");
}

export function UsersView({
  canManage,
  canCreateEmployees,
}: {
  canManage: boolean;
  canCreateEmployees: boolean;
}) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [creatingFor, setCreatingFor] = useState<AppUser | null>(null);

  const users = useQuery({
    queryKey: ["users", q],
    queryFn: ({ signal }) =>
      api.get<AppUser[]>("/users", q ? { q, pageSize: "50" } : { pageSize: "50" }, signal),
  });

  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: ({ signal }) => api.get<Role[]>("/roles", undefined, signal),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["users"] });

  const action = useMutation({
    mutationFn: ({
      user,
      kind,
    }: {
      user: AppUser;
      kind: "enable" | "disable" | "unlock" | "resend";
    }) => {
      if (kind === "resend") return api.post(`/users/${user.id}/resend-invite`);
      if (kind === "unlock") return api.post(`/users/${user.id}/unlock`);
      return api.post(`/users/${user.id}/${kind}`);
    },
    onSuccess: (_r, { kind }) => {
      toast.success(
        kind === "resend"
          ? "Invite sent again"
          : kind === "unlock"
            ? "Account unlocked"
            : kind === "disable"
              ? "Account disabled"
              : "Account enabled",
      );
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not do that"),
  });

  const remove = useMutation({
    mutationFn: (user: AppUser) => api.delete(`/users/${user.id}`),
    onSuccess: () => {
      toast.success("Account removed");
      invalidate();
    },
    // The service refuses anything that has been used, and that refusal is the
    // useful part, so it is shown rather than replaced with a generic message.
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not remove"),
  });

  const rows = users.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>
            Who can sign in, and what each of them is allowed to do. Roles carry every permission —
            an account with none can sign in and see nothing.
          </CardDescription>
        </div>
        {canManage ? (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" />
            Invite user
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        <Input
          className="max-w-sm"
          placeholder="Search by email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        {users.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No accounts"
            description="Accounts are created by inviting an employee from the employee directory."
          />
        ) : (
          <div className="bg-card overflow-x-auto rounded-xl border shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <span className="font-medium">
                        {user.employee
                          ? fullName(user.employee.firstName, user.employee.lastName)
                          : user.email}
                      </span>
                      <span className="text-muted-foreground block text-xs">{user.email}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <UserStatusBadge status={user.status} />
                        {user.isLocked ? (
                          <Badge variant="secondary" className="bg-destructive/10 text-destructive">
                            Locked
                          </Badge>
                        ) : null}
                        {/*
                          A login with nothing behind it. Their profile,
                          attendance and leave all hang off an employee
                          record, so without one the application is empty for
                          them — which reads as broken rather than incomplete.
                        */}
                        {user.employee ? null : (
                          <Badge variant="secondary" className="bg-warning/12 text-warning">
                            No employee record
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.roles.length === 0 ? (
                        // The failure mode this screen exists to make visible.
                        <Badge variant="secondary" className="bg-warning/12 text-warning">
                          No role
                        </Badge>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {user.roles.map((r) => (
                            <Badge key={r.id} variant="outline" className="text-muted-foreground">
                              {roleLabel(r.name)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {user.lastLoginAt ? user.lastLoginAt.slice(0, 10) : "Never"}
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Roles for ${user.email}`}
                            onClick={() => setEditing(user)}
                          >
                            <ShieldCheck className="size-4" />
                            Roles
                          </Button>
                          {canCreateEmployees && !user.employee && user.status !== "disabled" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Create an employee record for ${user.email}`}
                              onClick={() => setCreatingFor(user)}
                            >
                              <IdCard className="size-4" />
                              Employee record
                            </Button>
                          ) : null}
                          {user.isLocked ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Unlock ${user.email}`}
                              disabled={action.isPending}
                              onClick={() => action.mutate({ user, kind: "unlock" })}
                            >
                              <Unlock className="size-4" />
                            </Button>
                          ) : null}
                          {user.status === "invited" ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Resend invite to ${user.email}`}
                              disabled={action.isPending}
                              onClick={() => action.mutate({ user, kind: "resend" })}
                            >
                              <Mail className="size-4" />
                            </Button>
                          ) : null}
                          {/* Only offered where it can actually succeed: a
                              never-used account with nothing pointing at it. */}
                          {user.status === "invited" && !user.lastLoginAt && !user.employee ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Delete ${user.email}`}
                              disabled={remove.isPending}
                              onClick={() => remove.mutate(user)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={
                              user.status === "disabled"
                                ? `Enable ${user.email}`
                                : `Disable ${user.email}`
                            }
                            disabled={action.isPending}
                            onClick={() =>
                              action.mutate({
                                user,
                                kind: user.status === "disabled" ? "enable" : "disable",
                              })
                            }
                          >
                            {user.status === "disabled" ? (
                              <KeyRound className="size-4" />
                            ) : (
                              <UserX className="size-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/*
        Keyed on the account so the form starts blank for each one: without it
        a second account inherits whatever was typed for the first.
      */}
      {creatingFor ? (
        <CreateEmployeeDialog
          key={creatingFor.id}
          open
          onClose={() => {
            setCreatingFor(null);
            void queryClient.invalidateQueries({ queryKey: ["users"] });
          }}
          forAccount={{ id: creatingFor.id, email: creatingFor.email }}
        />
      ) : null}

      <Dialog open={inviteOpen} onOpenChange={(next) => !next && setInviteOpen(false)}>
        <DialogContent>
          <InviteForm
            roles={roles.data ?? []}
            onDone={() => {
              setInviteOpen(false);
              invalidate();
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent>
          {editing ? (
            <RolesForm
              user={editing}
              roles={roles.data ?? []}
              onDone={() => {
                setEditing(null);
                invalidate();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function RolesForm({ user, roles, onDone }: { user: AppUser; roles: Role[]; onDone: () => void }) {
  const held = new Set(user.roles.map((r) => r.id));
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = useMutation({
    mutationFn: ({ roleId, add }: { roleId: string; add: boolean }) =>
      add
        ? api.post(`/users/${user.id}/roles`, { roleId })
        : api.delete(`/users/${user.id}/roles/${roleId}`),
    onMutate: ({ roleId }) => setPending(roleId),
    onSuccess: () => {
      setError(null);
      onDone();
    },
    // The server refuses to remove the last HR admin, which is the guard worth
    // showing rather than swallowing.
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not change roles"),
    onSettled: () => setPending(null),
  });

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Roles for {user.email}</DialogTitle>
        <DialogDescription>
          Roles are additive — somebody can be both a manager and an HR admin. Changes take effect
          the next time they load a page.
        </DialogDescription>
      </DialogHeader>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <ul className="space-y-2">
        {roles.map((role) => (
          <li key={role.id}>
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox
                checked={held.has(role.id)}
                disabled={toggle.isPending}
                onCheckedChange={(checked) =>
                  toggle.mutate({ roleId: role.id, add: checked === true })
                }
              />
              <span className="capitalize">{roleLabel(role.name)}</span>
              {pending === role.id ? <Loader2 className="size-3.5 animate-spin" /> : null}
            </label>
          </li>
        ))}
      </ul>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}

interface UnlinkedEmployee {
  id: string;
  firstName: string;
  lastName: string | null;
  employeeCode: string;
  workEmail: string | null;
  designation: { title: string } | null;
}

function InviteForm({ roles, onDone }: { roles: Role[]; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  // Records with nobody signed in against them. Offered so an invite meant
  // for a member of staff arrives attached to their person, rather than
  // producing a login that cannot be connected to one afterwards.
  const unlinked = useQuery({
    queryKey: ["employees", "unlinked-options"],
    queryFn: () => api.get<UnlinkedEmployee[]>("/employees/unlinked-options"),
  });
  const candidates = unlinked.data ?? [];

  const submit = useMutation({
    mutationFn: () =>
      api.post<{ userId: string; inviteUrl?: string }>("/users/invite", {
        email,
        roleIds,
        employeeId: employeeId || null,
      }),
    onSuccess: (result) => {
      toast.success("Invite created");
      // Outside production the API hands the link back, so development needs
      // no mailbox. In production it is emailed and never returned.
      if (result.inviteUrl) setInviteUrl(result.inviteUrl);
      else onDone();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not invite"),
  });

  if (inviteUrl) {
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Invite created</DialogTitle>
          <DialogDescription>
            No mail is sent outside production, so here is the link. Single use, expires in seven
            days.
          </DialogDescription>
        </DialogHeader>
        <code className="bg-muted rounded-lg p-3 text-xs break-all">{inviteUrl}</code>
        <DialogFooter>
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        submit.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Invite a user</DialogTitle>
        <DialogDescription>
          For somebody who administers the system rather than appears on the payroll. A new hire is
          better invited from their employee record, which links the account to the person.
        </DialogDescription>
      </DialogHeader>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="grid gap-2">
        <Label htmlFor="invite-email">Work email</Label>
        <Input
          id="invite-email"
          type="email"
          required
          autoFocus
          value={email}
          placeholder="name@company.com"
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      {candidates.length > 0 ? (
        <div className="grid gap-2">
          <Label htmlFor="invite-employee">Employee record</Label>
          <Select
            items={Object.fromEntries(
              candidates.map((row) => [row.id, `${row.firstName} ${row.lastName ?? ""}`.trim()]),
            )}
            value={employeeId}
            onValueChange={(value) => {
              setEmployeeId(value ?? "");
              // Their work email is almost always the address being invited,
              // and typing it twice is how the two end up disagreeing.
              const picked = candidates.find((row) => row.id === value);
              if (picked?.workEmail && !email) setEmail(picked.workEmail);
            }}
          >
            <SelectTrigger id="invite-employee" className="w-full">
              <SelectValue placeholder="None — this account is not a member of staff" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {[row.firstName, row.lastName].filter(Boolean).join(" ")} · {row.employeeCode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            Leave this empty for an administrator. Attaching a record now is what lets the person
            see their own profile, attendance and leave.
          </p>
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label>Roles</Label>
        {roles.map((role) => (
          <label key={role.id} className="flex items-center gap-2.5 text-sm">
            <Checkbox
              checked={roleIds.includes(role.id)}
              onCheckedChange={(checked) =>
                setRoleIds((ids) =>
                  checked === true ? [...ids, role.id] : ids.filter((id) => id !== role.id),
                )
              }
            />
            <span className="capitalize">{roleLabel(role.name)}</span>
          </label>
        ))}
        <p className="text-muted-foreground text-xs">
          At least one. An account with no roles signs in to an empty application.
        </p>
      </div>

      <DialogFooter>
        <Button type="submit" disabled={submit.isPending || roleIds.length === 0}>
          {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Send invite
        </Button>
      </DialogFooter>
    </form>
  );
}

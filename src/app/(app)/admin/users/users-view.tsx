"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Mail, ShieldCheck, Unlock, UserX } from "lucide-react";
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

export function UsersView({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<AppUser | null>(null);

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

  const rows = users.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Accounts</CardTitle>
        <CardDescription>
          Who can sign in, and what each of them is allowed to do. Roles carry every permission — an
          account with none can sign in and see nothing.
        </CardDescription>
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
                      <div className="flex items-center gap-1.5">
                        <UserStatusBadge status={user.status} />
                        {user.isLocked ? (
                          <Badge variant="secondary" className="bg-destructive/10 text-destructive">
                            Locked
                          </Badge>
                        ) : null}
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

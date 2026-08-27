"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { DetailCardSkeleton } from "@/components/shared/skeletons";
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
import { api } from "@/lib/api-client";

interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissions: string[];
}

interface PermissionGroup {
  module: string;
  permissions: string[];
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super admin",
  hr_admin: "HR admin",
  manager: "Manager",
  employee: "Employee",
};

const rolesKey = ["rbac", "roles"] as const;

function roleLabel(name: string): string {
  return ROLE_LABELS[name] ?? name.replace(/_/g, " ");
}

export function RolesView({
  canManage,
  grantable,
}: {
  canManage: boolean;
  /**
   * What this person may put in a role — their own permissions.
   *
   * Passed from the server rather than fetched, because the server already
   * knows and the alternative is a screen that offers a tick the API will
   * refuse. The API refuses it either way; this is so nobody finds out by
   * being told no.
   */
  grantable: string[];
}) {
  const roles = useQuery({
    queryKey: rolesKey,
    queryFn: ({ signal }) => api.get<Role[]>("/roles", undefined, signal),
  });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [removing, setRemoving] = useState<Role | null>(null);

  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: rolesKey });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/roles/${id}`),
    onSuccess: invalidate,
  });

  if (roles.isLoading) return <DetailCardSkeleton fields={4} />;

  if (roles.isError || !roles.data) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Could not load roles"
        description={roles.error instanceof Error ? roles.error.message : undefined}
      />
    );
  }

  const grantableSet = new Set(grantable);

  return (
    <div className="grid gap-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Add role
          </Button>
        </div>
      ) : null}

      {roles.data.map((role) => (
        <Card key={role.id}>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{roleLabel(role.name)}</CardTitle>
                {role.isSystem ? <Badge variant="secondary">System role</Badge> : null}
                <Badge variant="outline">
                  {role.userCount} user{role.userCount === 1 ? "" : "s"}
                </Badge>
              </div>
              {role.description ? <CardDescription>{role.description}</CardDescription> : null}
            </div>

            {canManage && !role.isSystem ? (
              <div className="flex gap-2">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Edit ${roleLabel(role.name)}`}
                  onClick={() => setEditing(role)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete ${roleLabel(role.name)}`}
                  onClick={() => setRemoving(role)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-2 text-sm">
              {role.permissions.length} permissions
            </p>
            <div className="flex flex-wrap gap-1.5">
              {role.permissions.map((code) => (
                <Badge key={code} variant="secondary" className="font-mono text-[11px] font-normal">
                  {code}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <p className="text-muted-foreground text-sm">
        The four system roles are seeded from the role matrix and cannot be changed — they are the
        floor the permission tests are written against. Roles of your own sit alongside them, and
        can hold anything you hold yourself.
      </p>

      <RoleDialog
        open={creating || editing !== null}
        role={editing}
        grantable={grantableSet}
        onDone={() => {
          setCreating(false);
          setEditing(null);
          invalidate();
        }}
      />

      <Dialog open={removing !== null} onOpenChange={(next) => !next && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {removing ? roleLabel(removing.name) : ""}?</DialogTitle>
            <DialogDescription>
              {removing && removing.userCount > 0
                ? `${removing.userCount} ${removing.userCount === 1 ? "person holds" : "people hold"} this role. Take it off them first — deleting it would change what they can do without telling them.`
                : "Nobody holds it, so nothing changes for anybody."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending || (removing?.userCount ?? 0) > 0}
              onClick={() => {
                if (!removing) return;
                remove.mutate(removing.id, {
                  onSuccess: () => {
                    toast.success("Role deleted");
                    setRemoving(null);
                  },
                  onError: (error: unknown) =>
                    toast.error(error instanceof Error ? error.message : "Could not delete"),
                });
              }}
            >
              {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleDialog({
  open,
  role,
  grantable,
  onDone,
}: {
  open: boolean;
  role: Role | null;
  grantable: ReadonlySet<string>;
  onDone: () => void;
}) {
  const catalogue = useQuery({
    queryKey: ["rbac", "permissions"],
    queryFn: ({ signal }) => api.get<PermissionGroup[]>("/permissions", undefined, signal),
    enabled: open,
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<string | null>(null);

  // Fill from the role being edited, once per dialog opening.
  const key = role?.id ?? "new";
  if (open && seeded !== key) {
    setSeeded(key);
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setChosen(new Set(role?.permissions ?? []));
    setError(null);
  }

  const save = useMutation({
    mutationFn: async () => {
      if (role) {
        await api.patch(`/roles/${role.id}`, { description: description.trim() || null });
        await api.put(`/roles/${role.id}/permissions`, { permissions: [...chosen] });
        return;
      }
      await api.post("/roles", {
        name: name.trim(),
        description: description.trim() || null,
        permissions: [...chosen],
      });
    },
    onSuccess: () => {
      toast.success(role ? "Role updated" : "Role created");
      setSeeded(null);
      onDone();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not save the role"),
  });

  const toggle = (code: string) => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setSeeded(null);
          onDone();
        }
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{role ? `Edit ${roleLabel(role.name)}` : "Add a role"}</DialogTitle>
          <DialogDescription>
            A role can hold anything you hold yourself. Permissions you do not have are shown but
            cannot be ticked — you cannot grant what you were not given.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          {role ? null : (
            <div className="grid gap-2">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                value={name}
                maxLength={60}
                placeholder="recruiter"
                onChange={(event) => setName(event.target.value.toLowerCase())}
              />
              <p className="text-muted-foreground text-sm">
                Lower case, no spaces. It is what audit rows and the permission matrix will call it,
                and it cannot be changed afterwards.
              </p>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="role-description">Description</Label>
            <Input
              id="role-description"
              value={description}
              maxLength={200}
              placeholder="What this role is for"
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <p className="text-sm font-medium">Permissions ({chosen.size})</p>
            {catalogue.isLoading ? (
              <p className="text-muted-foreground text-sm">Loading the catalogue…</p>
            ) : (
              <div className="grid gap-4">
                {(catalogue.data ?? []).map((group) => (
                  <div key={group.module}>
                    <p className="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wider uppercase">
                      {group.module}
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {group.permissions.map((code) => {
                        const allowed = grantable.has(code);
                        return (
                          <label
                            key={code}
                            className={`flex items-center gap-2 text-sm ${allowed ? "" : "opacity-50"}`}
                          >
                            <Checkbox
                              checked={chosen.has(code)}
                              disabled={!allowed}
                              onCheckedChange={() => toggle(code)}
                            />
                            <span className="font-mono text-[11px]">{code}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setSeeded(null);
              onDone();
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={save.isPending || (!role && name.trim().length < 2)}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {role ? "Save changes" : "Create role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

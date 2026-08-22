"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api-client";

interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissions: string[];
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super admin",
  hr_admin: "HR admin",
  manager: "Manager",
  employee: "Employee",
};

export function RolesView() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["rbac", "roles"],
    queryFn: ({ signal }) => api.get<Role[]>("/roles", undefined, signal),
  });

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 rounded-lg border py-16 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading roles
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Could not load roles"
        description={error instanceof Error ? error.message : undefined}
      />
    );
  }

  return (
    <div className="grid gap-4">
      {data.map((role) => (
        <Card key={role.id}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{ROLE_LABELS[role.name] ?? role.name}</CardTitle>
              {role.isSystem ? <Badge variant="secondary">System role</Badge> : null}
              <Badge variant="outline">
                {role.userCount} user{role.userCount === 1 ? "" : "s"}
              </Badge>
            </div>
            {role.description ? <CardDescription>{role.description}</CardDescription> : null}
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
        System roles are seeded from the role matrix and are read-only. Custom roles arrive in Phase
        3; because permissions are data rather than code, that is a new row, not a new release.
      </p>
    </div>
  );
}

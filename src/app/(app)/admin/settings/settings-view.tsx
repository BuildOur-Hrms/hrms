"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { DetailCardSkeleton } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api-client";

interface Setting {
  key: string;
  value: unknown;
  group: string;
  label: string;
  scope: "global" | "company";
  default: unknown;
  editable: boolean;
}

const GROUP_LABELS: Record<string, string> = {
  general: "General",
  attendance: "Attendance",
  leave: "Leave",
  security: "Security",
  notifications: "Notifications",
};

const settingsKey = ["settings"] as const;

export function SettingsView() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: settingsKey,
    queryFn: ({ signal }) => api.get<Setting[]>("/settings", undefined, signal),
  });

  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      api.put(`/settings/${key}`, { value }),
    onSuccess: () => {
      toast.success("Setting saved");
      void queryClient.invalidateQueries({ queryKey: settingsKey });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not save that setting"),
  });

  if (isLoading) {
    return <DetailCardSkeleton fields={6} />;
  }

  if (error || !data) {
    return (
      <EmptyState
        title="Could not load settings"
        description={error instanceof Error ? error.message : undefined}
      />
    );
  }

  const groups = [...new Set(data.map((setting) => setting.group))];

  return (
    <Tabs defaultValue={groups[0]}>
      <TabsList>
        {groups.map((group) => (
          <TabsTrigger key={group} value={group}>
            {GROUP_LABELS[group] ?? group}
          </TabsTrigger>
        ))}
      </TabsList>

      {groups.map((group) => (
        <TabsContent key={group} value={group} className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{GROUP_LABELS[group] ?? group}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {data
                .filter((setting) => setting.group === group)
                .map((setting) => (
                  <SettingRow
                    key={setting.key}
                    setting={setting}
                    saving={save.isPending}
                    onSave={(value) => save.mutate({ key: setting.key, value })}
                  />
                ))}
            </CardContent>
          </Card>
        </TabsContent>
      ))}
    </Tabs>
  );
}

function SettingRow({
  setting,
  saving,
  onSave,
}: {
  setting: Setting;
  saving: boolean;
  onSave: (value: unknown) => void;
}) {
  const [draft, setDraft] = useState(() => formatValue(setting.value));
  const isBoolean = typeof setting.default === "boolean";
  const isNumber = typeof setting.default === "number";
  const isArray = Array.isArray(setting.default);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium">{setting.label}</p>
          {setting.scope === "global" ? <Badge variant="outline">Platform</Badge> : null}
        </div>
        <p className="text-muted-foreground font-mono text-xs">{setting.key}</p>
      </div>

      <div className="flex items-center gap-2">
        {isBoolean ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={setting.value === true}
              disabled={!setting.editable || saving}
              onCheckedChange={(checked) => onSave(checked === true)}
            />
            Enabled
          </label>
        ) : (
          <>
            <Label htmlFor={setting.key} className="sr-only">
              {setting.label}
            </Label>
            <Input
              id={setting.key}
              className="w-56"
              value={draft}
              disabled={!setting.editable || saving}
              type={isNumber ? "number" : "text"}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!setting.editable || saving || draft === formatValue(setting.value)}
              onClick={() => onSave(parseValue(draft, { isNumber, isArray }))}
            >
              Save
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * The catalog validates the parsed value server-side, so this only has to get
 * the JSON *type* right — a number stays a number and a weekday list stays an
 * array of numbers rather than arriving as a string.
 */
function parseValue(raw: string, hints: { isNumber: boolean; isArray: boolean }): unknown {
  if (hints.isNumber) return Number(raw);
  if (hints.isArray) {
    return raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => (Number.isNaN(Number(part)) ? part : Number(part)));
  }
  return raw;
}

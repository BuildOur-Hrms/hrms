"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Megaphone, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";

interface Announcement {
  id: string;
  title: string;
  bodyHtml: string;
  audience: "company" | "department";
  publishedAt: string | null;
  department: { id: string; name: string } | null;
  author: { id: string; email: string };
}

interface Department {
  id: string;
  name: string;
}

export function AnnouncementsView() {
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["announcements", "admin"],
    queryFn: ({ signal }) =>
      api.get<Announcement[]>("/announcements", { includeDrafts: "true" }, signal),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["announcements"] });

  const publish = useMutation({
    mutationFn: (id: string) => api.post(`/announcements/${id}/publish`),
    onSuccess: () => {
      toast.success("Published — everyone it reaches has been notified");
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not publish"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/announcements/${id}`),
    onSuccess: () => {
      toast.success("Announcement removed");
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not remove"),
  });

  const rows = data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Posted</CardTitle>
          <CardDescription>
            Drafts are visible only here. Publishing is what sends the notification, and it only
            happens once.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setComposing(true)}>
          <Megaphone className="size-4" />
          New announcement
        </Button>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState icon={Megaphone} title="Nothing posted yet" />
        ) : (
          <ul className="space-y-3">
            {rows.map((a) => (
              <li key={a.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.title}</span>
                  <Badge variant="outline" className="text-muted-foreground">
                    {a.audience === "company"
                      ? "Company-wide"
                      : (a.department?.name ?? "Department")}
                  </Badge>
                  {a.publishedAt ? (
                    <Badge variant="secondary" className="bg-success/12 text-success">
                      Published
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-warning/12 text-warning">
                      Draft
                    </Badge>
                  )}
                  <div className="ml-auto flex gap-1">
                    {!a.publishedAt ? (
                      <Button
                        size="sm"
                        disabled={publish.isPending}
                        onClick={() => publish.mutate(a.id)}
                      >
                        <Send className="size-4" />
                        Publish
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${a.title}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(a.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                <div
                  className="text-muted-foreground mt-2 text-sm [&_li]:ml-4 [&_li]:list-disc"
                  dangerouslySetInnerHTML={{ __html: a.bodyHtml }}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={composing} onOpenChange={(next) => !next && setComposing(false)}>
        <DialogContent>
          <ComposeForm
            onDone={() => {
              setComposing(false);
              invalidate();
            }}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ComposeForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"company" | "department">("company");
  const [departmentId, setDepartmentId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const departments = useQuery({
    queryKey: ["org", "departments"],
    queryFn: ({ signal }) => api.get<Department[]>("/departments", undefined, signal),
  });

  const submit = useMutation({
    mutationFn: (publish: boolean) =>
      api.post("/announcements", {
        title,
        // Plain paragraphs. Anything richer is sanitised server-side against
        // an allowlist, so pasted markup cannot carry a script through.
        bodyHtml: body
          .split(/\n{2,}/)
          .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
          .join(""),
        audience,
        departmentId: audience === "department" ? departmentId : null,
        publish,
      }),
    onSuccess: (_r, publish) => {
      toast.success(publish ? "Published" : "Saved as a draft");
      onDone();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not save"),
  });

  const ready = title.trim().length >= 3 && body.trim().length > 0;
  const needsDepartment = audience === "department" && !departmentId;

  return (
    <form className="grid gap-4" onSubmit={(e) => e.preventDefault()}>
      <DialogHeader>
        <DialogTitle>New announcement</DialogTitle>
        <DialogDescription>
          Save it as a draft to check it first. Publishing notifies everyone it reaches and cannot
          be undone by unpublishing.
        </DialogDescription>
      </DialogHeader>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="grid gap-2">
        <Label htmlFor="ann-title">Title</Label>
        <Input
          id="ann-title"
          required
          autoFocus
          value={title}
          placeholder="Office closed on Friday"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="ann-body">Message</Label>
        <Textarea
          id="ann-body"
          required
          rows={6}
          value={body}
          placeholder="Leave a blank line between paragraphs."
          onChange={(e) => setBody(e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="ann-audience">Audience</Label>
          <Select
            value={audience}
            onValueChange={(v) => setAudience((v ?? "company") as "company" | "department")}
          >
            <SelectTrigger id="ann-audience" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="company">The whole company</SelectItem>
              <SelectItem value="department">One department</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {audience === "department" ? (
          <div className="grid gap-2">
            <Label htmlFor="ann-department">Department</Label>
            <Select value={departmentId} onValueChange={(v) => setDepartmentId(v ?? "")}>
              <SelectTrigger id="ann-department" className="w-full">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {(departments.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={!ready || needsDepartment || submit.isPending}
          onClick={() => submit.mutate(false)}
        >
          Save draft
        </Button>
        <Button
          type="button"
          disabled={!ready || needsDepartment || submit.isPending}
          onClick={() => submit.mutate(true)}
        >
          {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Publish now
        </Button>
      </DialogFooter>
    </form>
  );
}

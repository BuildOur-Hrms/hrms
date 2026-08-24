"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Briefcase, Loader2, Plus, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
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
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";

import { ApplicationDrawer } from "./application-drawer";
import {
  JOB_TINT,
  STAGES,
  STAGE_LABEL,
  STAGE_TINT,
  candidateName,
  formatMoney,
  type ApplicationRow,
  type Job,
  type JobDetail,
  type Stage,
} from "./types";

/**
 * Hiring: the list of what we are recruiting for, and the board for one role.
 *
 * The board is a column per stage rather than a table, because the question a
 * recruiter opens this with is "where is everybody" — and a table sorted by
 * stage answers it a scroll at a time.
 */

interface OrgOptions {
  departments: { id: string; name: string }[];
  designations: { id: string; title: string }[];
  locations: { id: string; name: string }[];
  ready: boolean;
}

export function RecruitmentWorkspace({ canApprove }: { canApprove: boolean }) {
  const [jobId, setJobId] = useState<string | null>(null);

  return jobId ? (
    <JobBoard jobId={jobId} canApprove={canApprove} onBack={() => setJobId(null)} />
  ) : (
    <JobList onOpen={setJobId} />
  );
}

// ─────────────────────────────────────────────── the list of roles

function JobList({ onOpen }: { onOpen: (id: string) => void }) {
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const jobs = useQuery({
    queryKey: ["recruitment", "jobs"],
    queryFn: ({ signal }) => api.get<Job[]>("/recruitment/jobs", undefined, signal),
    placeholderData: keepPreviousData,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.post(`/recruitment/jobs/${id}/status`, { status }),
    onSuccess: () => {
      toast.success("Job updated");
      void queryClient.invalidateQueries({ queryKey: ["recruitment"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not update the job"),
  });

  if (jobs.isLoading) return <Skeleton className="h-64 w-full" />;

  const rows = jobs.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New role
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="Nothing open"
          description="Create a role and candidates can be put against it."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((job) => (
            <Card key={job.id}>
              <CardContent className="flex h-full flex-col items-start gap-3 p-5">
                <div className="flex w-full items-start justify-between gap-2">
                  <p className="font-medium">{job.title}</p>
                  <Badge variant="secondary" className={JOB_TINT[job.status]}>
                    {job.status.replace("_", " ")}
                  </Badge>
                </div>

                <p className="text-muted-foreground text-sm">
                  {job.department.name} · {job.designation.title} · {job.location.name}
                </p>
                <p className="text-muted-foreground text-sm">
                  {job.openings} opening{job.openings === 1 ? "" : "s"}
                  {job.salaryMin !== null
                    ? ` · ${formatMoney(job.salaryMin)}–${formatMoney(job.salaryMax)}`
                    : ""}
                </p>

                <div className="mt-auto flex w-full items-center gap-2 pt-2">
                  <Button size="xs" variant="outline" onClick={() => onOpen(job.id)}>
                    Open board
                    <span className="text-muted-foreground ml-1 tabular-nums">
                      {job._count?.applications ?? 0}
                    </span>
                  </Button>

                  {job.status === "draft" ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ id: job.id, status: "open" })}
                    >
                      Publish
                    </Button>
                  ) : null}
                  {job.status === "open" ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ id: job.id, status: "closed" })}
                    >
                      Close
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NewJobDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["recruitment"] })}
      />
    </div>
  );
}

function NewJobDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [openings, setOpenings] = useState("1");
  const [error, setError] = useState<string | null>(null);

  const org = useQuery({
    queryKey: ["org", "options"],
    queryFn: ({ signal }) => api.get<OrgOptions>("/org/options", undefined, signal),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post("/recruitment/jobs", {
        title,
        departmentId,
        designationId,
        locationId,
        employmentType,
        openings: Number(openings),
      }),
    onSuccess: () => {
      toast.success("Role created as a draft");
      setTitle("");
      onCreated();
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not create it"),
  });

  const complete = title.trim().length >= 3 && departmentId && designationId && locationId;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>A role to hire for</DialogTitle>
            <DialogDescription>
              Created as a draft. Publish it when you are ready for candidates.
            </DialogDescription>
          </DialogHeader>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <div className="grid gap-2">
            <Label htmlFor="job-title">Title</Label>
            <Input
              id="job-title"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Picker
              id="job-department"
              label="Department"
              options={(org.data?.departments ?? []).map((d) => ({ id: d.id, label: d.name }))}
              value={departmentId}
              onChange={setDepartmentId}
            />
            <Picker
              id="job-designation"
              label="Designation"
              options={(org.data?.designations ?? []).map((d) => ({ id: d.id, label: d.title }))}
              value={designationId}
              onChange={setDesignationId}
            />
            <Picker
              id="job-location"
              label="Location"
              options={(org.data?.locations ?? []).map((l) => ({ id: l.id, label: l.name }))}
              value={locationId}
              onChange={setLocationId}
            />
            <Picker
              id="job-type"
              label="Employment type"
              options={[
                { id: "full_time", label: "Full time" },
                { id: "part_time", label: "Part time" },
                { id: "contract", label: "Contract" },
                { id: "intern", label: "Intern" },
              ]}
              value={employmentType}
              onChange={setEmploymentType}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="job-openings">Openings</Label>
            <Input
              id="job-openings"
              type="number"
              min={1}
              className="w-28"
              value={openings}
              onChange={(event) => setOpenings(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !complete}>
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Create it
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Picker({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: { id: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        items={Object.fromEntries(options.map((option) => [option.id, option.label]))}
        value={value}
        onValueChange={(next) => onChange(next ?? "")}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─────────────────────────────────────────────── one role's board

function JobBoard({
  jobId,
  canApprove,
  onBack,
}: {
  jobId: string;
  canApprove: boolean;
  onBack: () => void;
}) {
  const [openApplication, setOpenApplication] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const queryClient = useQueryClient();

  const job = useQuery({
    queryKey: ["recruitment", "job", jobId],
    queryFn: ({ signal }) => api.get<JobDetail>(`/recruitment/jobs/${jobId}`, undefined, signal),
  });

  const applications = useQuery({
    queryKey: ["recruitment", "applications", jobId],
    queryFn: ({ signal }) =>
      api.get<ApplicationRow[]>("/recruitment/applications", { jobPostingId: jobId }, signal),
    placeholderData: keepPreviousData,
  });

  const rows = applications.data ?? [];
  const byStage = (stage: Stage) => rows.filter((row) => row.stage === stage);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{job.data?.title ?? "…"}</h2>
          {job.data ? (
            <p className="text-muted-foreground text-sm">
              {job.data.department.name} · {job.data.location.name} · {job.data.openings} opening
              {job.data.openings === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <UserPlus className="size-4" />
            Add a candidate
          </Button>
          <Button size="sm" variant="outline" onClick={onBack}>
            <ArrowLeft className="size-4" />
            All roles
          </Button>
        </div>
      </div>

      {applications.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-6">
          {STAGES.map((stage) => (
            <Card key={stage} className="min-w-0">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  {STAGE_LABEL[stage]}
                  <Badge variant="secondary" className={`${STAGE_TINT[stage]} tabular-nums`}>
                    {byStage(stage).length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {byStage(stage).map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setOpenApplication(row.id)}
                    className="bg-card hover:bg-muted w-full rounded-lg border p-2.5 text-left text-sm transition-colors"
                  >
                    <span className="block font-medium">{candidateName(row.candidate)}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {row.candidate.email}
                    </span>
                    {row._count && row._count.interviews > 0 ? (
                      <span className="text-muted-foreground mt-1 block text-xs">
                        {row._count.interviews} round
                        {row._count.interviews === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </button>
                ))}
                {byStage(stage).length === 0 ? (
                  <p className="text-muted-foreground py-2 text-xs">Nobody here</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ApplicationDrawer
        applicationId={openApplication}
        canApprove={canApprove}
        onClose={() => setOpenApplication(null)}
      />
      <AddCandidateDialog
        open={adding}
        jobId={jobId}
        onClose={() => setAdding(false)}
        onAdded={() => queryClient.invalidateQueries({ queryKey: ["recruitment"] })}
      />
    </div>
  );
}

/**
 * Adding somebody to a role.
 *
 * Two steps in one dialog on purpose: a candidate is a person in the talent
 * pool and an application is that person against this job, and making a
 * recruiter do them separately is how the pool fills up with people nobody
 * ever applied anywhere.
 */
function AddCandidateDialog({
  open,
  jobId,
  onClose,
  onAdded,
}: {
  open: boolean;
  jobId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("direct");
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: async () => {
      const candidate = await api.post<{ id: string }>("/recruitment/candidates", {
        firstName,
        lastName: lastName || null,
        email,
        source,
      });
      await api.post("/recruitment/applications", {
        candidateId: candidate.id,
        jobPostingId: jobId,
      });
    },
    onSuccess: () => {
      toast.success("Candidate added");
      setFirstName("");
      setLastName("");
      setEmail("");
      setError(null);
      onAdded();
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not add them"),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            add.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a candidate to this role</DialogTitle>
            <DialogDescription>
              They join the talent pool as well, so they can be found again for the next role.
            </DialogDescription>
          </DialogHeader>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="cand-first">First name</Label>
              <Input
                id="cand-first"
                required
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cand-last">Last name</Label>
              <Input
                id="cand-last"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cand-email">Email</Label>
            <Input
              id="cand-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <Picker
            id="cand-source"
            label="Where they came from"
            options={[
              { id: "direct", label: "Direct" },
              { id: "referral", label: "Referral" },
              { id: "agency", label: "Agency" },
              { id: "portal", label: "Portal" },
            ]}
            value={source}
            onChange={setSource}
          />

          <DialogFooter>
            <Button type="submit" disabled={add.isPending || !firstName.trim() || !email.trim()}>
              {add.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Add them
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

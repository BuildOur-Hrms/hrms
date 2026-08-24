"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, Loader2, Send, UserCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

import {
  OFFER_TINT,
  RECOMMENDATION_LABEL,
  STAGE_LABEL,
  STAGE_TINT,
  candidateName,
  formatMoney,
  type ApplicationDetail,
} from "./types";

/**
 * Everything about one application, in the place somebody is already looking.
 *
 * A drawer rather than a page: moving a candidate along, booking a round and
 * writing an offer are all things done while scanning the board, and a
 * navigation between each would turn a morning of triage into a morning of
 * back buttons.
 */

interface Option {
  id: string;
  label: string;
}

export function ApplicationDrawer({
  applicationId,
  onClose,
  canApprove,
}: {
  applicationId: string | null;
  onClose: () => void;
  canApprove: boolean;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const application = useQuery({
    queryKey: ["recruitment", "application", applicationId],
    queryFn: ({ signal }) =>
      api.get<ApplicationDetail>(`/recruitment/applications/${applicationId}`, undefined, signal),
    enabled: applicationId !== null,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["recruitment"] });
  };

  const data = application.data;

  return (
    <Dialog
      open={applicationId !== null}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        {!data ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{candidateName(data.candidate)}</DialogTitle>
              <DialogDescription>
                {data.candidate.email}
                {data.candidate.phone ? ` · ${data.candidate.phone}` : ""} · applied to{" "}
                {data.jobPosting.title}
              </DialogDescription>
            </DialogHeader>

            {error ? <p className="text-destructive text-sm">{error}</p> : null}

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className={STAGE_TINT[data.stage]}>
                {STAGE_LABEL[data.stage]}
              </Badge>
              {data.rejectionReason ? (
                <span className="text-muted-foreground text-sm">{data.rejectionReason}</span>
              ) : null}
            </div>

            <StageControls application={data} onChanged={refresh} onError={setError} />
            <Interviews application={data} onChanged={refresh} onError={setError} />
            <Offers
              application={data}
              canApprove={canApprove}
              onChanged={refresh}
              onError={setError}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────── stage

function StageControls({
  application,
  onChanged,
  onError,
}: {
  application: ApplicationDetail;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const move = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post(`/recruitment/applications/${application.id}/stage`, body),
    onSuccess: () => {
      toast.success("Moved");
      setRejecting(false);
      setReason("");
      onChanged();
    },
    onError: (e: unknown) => onError(e instanceof Error ? e.message : "Could not move it"),
  });

  if (application.stage === "hired") {
    return (
      <p className="text-muted-foreground text-sm">
        This application ended in a hire and is closed.
      </p>
    );
  }

  const next = (["applied", "screening", "interview", "offer"] as const).filter(
    (stage) => stage !== application.stage,
  );

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Move to</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {next.map((stage) => (
          <Button
            key={stage}
            size="xs"
            variant="outline"
            disabled={move.isPending}
            onClick={() => {
              onError(null);
              move.mutate({ stage });
            }}
          >
            {STAGE_LABEL[stage]}
          </Button>
        ))}
        {application.stage !== "rejected" ? (
          <Button
            size="xs"
            variant="ghost"
            className="text-destructive"
            onClick={() => setRejecting((open) => !open)}
          >
            Reject
          </Button>
        ) : null}
      </div>

      {rejecting ? (
        <div className="grid gap-2 pt-1">
          <Label htmlFor="reject-reason">Why</Label>
          <Textarea
            id="reject-reason"
            rows={2}
            value={reason}
            placeholder="Strong on delivery, not enough depth on the systems side."
            onChange={(event) => setReason(event.target.value)}
          />
          <div>
            <Button
              size="sm"
              variant="destructive"
              disabled={move.isPending || reason.trim().length < 3}
              onClick={() => {
                onError(null);
                move.mutate({ stage: "rejected", rejectionReason: reason });
              }}
            >
              {move.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Reject this application
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────── interviews

function Interviews({
  application,
  onChanged,
  onError,
}: {
  application: ApplicationDetail;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [roundName, setRoundName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [interviewerId, setInterviewerId] = useState("");
  const [mode, setMode] = useState("video");

  const interviewers = useQuery({
    queryKey: ["employees", "interviewers"],
    queryFn: ({ signal }) =>
      api.list<{ id: string; firstName: string; lastName: string | null }>(
        "/employees",
        { pageSize: 100 },
        signal,
      ),
    enabled: open,
  });

  const schedule = useMutation({
    mutationFn: () =>
      api.post("/recruitment/interviews", {
        applicationId: application.id,
        roundName,
        scheduledAt: new Date(scheduledAt).toISOString(),
        interviewerId,
        mode,
      }),
    onSuccess: () => {
      toast.success("Interview scheduled");
      setOpen(false);
      setRoundName("");
      setScheduledAt("");
      setInterviewerId("");
      onChanged();
    },
    onError: (e: unknown) => onError(e instanceof Error ? e.message : "Could not schedule it"),
  });

  const options: Option[] = (interviewers.data?.data ?? []).map((person) => ({
    id: person.id,
    label: candidateName(person),
  }));

  return (
    <section className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Interviews</p>
        <Button size="xs" variant="outline" onClick={() => setOpen((value) => !value)}>
          <CalendarPlus className="size-4" />
          Schedule
        </Button>
      </div>

      {application.interviews.length === 0 ? (
        <p className="text-muted-foreground text-sm">No rounds booked yet.</p>
      ) : (
        <ul className="divide-border divide-y">
          {application.interviews.map((interview) => (
            <li key={interview.id} className="space-y-1 py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-medium">{interview.roundName}</span>
                <span className="text-muted-foreground">
                  {new Date(interview.scheduledAt).toLocaleString()}
                </span>
                <span className="text-muted-foreground">
                  · {candidateName(interview.interviewer)}
                </span>
                {interview.submittedAt ? (
                  <Badge variant="secondary" className="ml-auto">
                    {RECOMMENDATION_LABEL[interview.recommendation ?? ""] ?? "Submitted"} ·{" "}
                    {interview.rating}/5
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground ml-auto">
                    Awaiting feedback
                  </Badge>
                )}
              </div>
              {interview.feedback ? (
                <p className="text-muted-foreground text-sm">{interview.feedback}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="round-name">Round</Label>
            <Input
              id="round-name"
              value={roundName}
              placeholder="System design"
              onChange={(event) => setRoundName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="round-when">When</Label>
            <Input
              id="round-when"
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="round-who">Interviewer</Label>
            <Select
              items={Object.fromEntries(options.map((option) => [option.id, option.label]))}
              value={interviewerId}
              onValueChange={(value) => setInterviewerId(value ?? "")}
            >
              <SelectTrigger id="round-who" className="w-full">
                <SelectValue placeholder="Choose somebody" />
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
          <div className="grid gap-2">
            <Label htmlFor="round-mode">Mode</Label>
            <Select
              items={{ video: "Video", onsite: "Onsite", phone: "Phone" }}
              value={mode}
              onValueChange={(value) => setMode(value ?? "video")}
            >
              <SelectTrigger id="round-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="video">Video</SelectItem>
                <SelectItem value="onsite">Onsite</SelectItem>
                <SelectItem value="phone">Phone</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Button
              size="sm"
              disabled={schedule.isPending || !roundName.trim() || !scheduledAt || !interviewerId}
              onClick={() => {
                onError(null);
                schedule.mutate();
              }}
            >
              {schedule.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Book it
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ─────────────────────────────────────────────── offers

function Offers({
  application,
  canApprove,
  onChanged,
  onError,
}: {
  application: ApplicationDetail;
  canApprove: boolean;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ctc, setCtc] = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [converting, setConverting] = useState<string | null>(null);

  const org = useQuery({
    queryKey: ["org", "options"],
    queryFn: ({ signal }) =>
      api.get<{ designations: { id: string; title: string }[] }>("/org/options", undefined, signal),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post("/recruitment/offers", {
        applicationId: application.id,
        designationId,
        // The form takes major units because that is what people say out
        // loud; the API stores minor units because that is what money is.
        ctc: Math.round(Number(ctc) * 100),
        joiningDate,
      }),
    onSuccess: () => {
      toast.success("Offer drafted");
      setOpen(false);
      setCtc("");
      onChanged();
    },
    onError: (e: unknown) => onError(e instanceof Error ? e.message : "Could not draft it"),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.post(`/recruitment/offers/${id}/status`, { status }),
    onSuccess: () => {
      toast.success("Offer updated");
      onChanged();
    },
    onError: (e: unknown) => onError(e instanceof Error ? e.message : "Could not update it"),
  });

  const live = application.offers.find(
    (offer) => offer.status === "draft" || offer.status === "sent",
  );
  const accepted = application.offers.find((offer) => offer.status === "accepted");

  return (
    <section className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Offers</p>
        {!live && !accepted && application.stage !== "hired" ? (
          <Button size="xs" variant="outline" onClick={() => setOpen((value) => !value)}>
            Draft an offer
          </Button>
        ) : null}
      </div>

      {application.offers.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing offered yet.</p>
      ) : (
        <ul className="divide-border divide-y">
          {application.offers.map((offer) => (
            <li key={offer.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <Badge variant="secondary" className={OFFER_TINT[offer.status]}>
                {offer.status}
              </Badge>
              <span className="font-medium tabular-nums">{formatMoney(offer.ctc)}</span>
              <span className="text-muted-foreground">
                {offer.designation.title} · joins {offer.joiningDate}
              </span>

              <div className="ml-auto flex gap-1.5">
                {offer.status === "draft" && canApprove ? (
                  <Button
                    size="xs"
                    disabled={setStatus.isPending}
                    onClick={() => {
                      onError(null);
                      setStatus.mutate({ id: offer.id, status: "sent" });
                    }}
                  >
                    <Send className="size-3.5" />
                    Approve and send
                  </Button>
                ) : null}
                {offer.status === "sent" ? (
                  <>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ id: offer.id, status: "accepted" })}
                    >
                      <Check className="size-3.5" />
                      Accepted
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ id: offer.id, status: "declined" })}
                    >
                      Declined
                    </Button>
                  </>
                ) : null}
                {offer.status === "accepted" && application.stage !== "hired" ? (
                  <Button size="xs" onClick={() => setConverting(offer.id)}>
                    <UserCheck className="size-3.5" />
                    Make them an employee
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {offerFormVisible(open, live, accepted, application.stage) ? (
        <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="offer-ctc">Annual package</Label>
            <Input
              id="offer-ctc"
              type="number"
              min={1}
              value={ctc}
              onChange={(event) => setCtc(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="offer-join">Joins on</Label>
            <Input
              id="offer-join"
              type="date"
              value={joiningDate}
              onChange={(event) => setJoiningDate(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="offer-designation">Designation</Label>
            <Select
              items={Object.fromEntries((org.data?.designations ?? []).map((d) => [d.id, d.title]))}
              value={designationId}
              onValueChange={(value) => setDesignationId(value ?? "")}
            >
              <SelectTrigger id="offer-designation" className="w-full">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {(org.data?.designations ?? []).map((designation) => (
                  <SelectItem key={designation.id} value={designation.id}>
                    {designation.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-3">
            <Button
              size="sm"
              disabled={create.isPending || !ctc || !joiningDate || !designationId}
              onClick={() => {
                onError(null);
                create.mutate();
              }}
            >
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Draft it
            </Button>
            <p className="text-muted-foreground mt-2 text-xs">
              A draft goes nowhere until somebody who can approve offers sends it.
            </p>
          </div>
        </div>
      ) : null}

      <ConvertDialog
        offerId={converting}
        onClose={() => setConverting(null)}
        onConverted={onChanged}
      />
    </section>
  );
}

function offerFormVisible(open: boolean, live: unknown, accepted: unknown, stage: string): boolean {
  return open && !live && !accepted && stage !== "hired";
}

function ConvertDialog({
  offerId,
  onClose,
  onConverted,
}: {
  offerId: string | null;
  onClose: () => void;
  onConverted: () => void;
}) {
  const [departmentId, setDepartmentId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const org = useQuery({
    queryKey: ["org", "options"],
    queryFn: ({ signal }) =>
      api.get<{
        departments: { id: string; name: string }[];
        locations: { id: string; name: string }[];
      }>("/org/options", undefined, signal),
    enabled: offerId !== null,
  });

  const convert = useMutation({
    mutationFn: () =>
      api.post(`/recruitment/offers/${offerId}/convert`, { departmentId, locationId }),
    onSuccess: () => {
      toast.success("Employee record created");
      onConverted();
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not convert"),
  });

  return (
    <Dialog open={offerId !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Make them an employee</DialogTitle>
          <DialogDescription>
            The designation, joining date and package come from the offer. Where they sit day to day
            does not, so it is asked for here. They start in onboarding, not active.
          </DialogDescription>
        </DialogHeader>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="convert-department">Department</Label>
            <Select
              items={Object.fromEntries((org.data?.departments ?? []).map((d) => [d.id, d.name]))}
              value={departmentId}
              onValueChange={(value) => setDepartmentId(value ?? "")}
            >
              <SelectTrigger id="convert-department" className="w-full">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {(org.data?.departments ?? []).map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convert-location">Location</Label>
            <Select
              items={Object.fromEntries((org.data?.locations ?? []).map((l) => [l.id, l.name]))}
              value={locationId}
              onValueChange={(value) => setLocationId(value ?? "")}
            >
              <SelectTrigger id="convert-location" className="w-full">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {(org.data?.locations ?? []).map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Button
            disabled={convert.isPending || !departmentId || !locationId}
            onClick={() => {
              setError(null);
              convert.mutate();
            }}
          >
            {convert.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Create the record
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

import { RECOMMENDATION_LABEL, candidateName, type Interview } from "./types";

/**
 * The rounds somebody has been asked to sit on.
 *
 * Deliberately spare. An interviewer needs the person, the round and the time,
 * and a box to write in afterwards — never the salary band, which is not in
 * the response this screen reads.
 *
 * Feedback submits once. Somebody who could revise after the debrief is not
 * giving an independent view, which is the only reason to collect it
 * separately in the first place.
 */

export function MyInterviews() {
  const interviews = useQuery({
    queryKey: ["recruitment", "interviews", "mine"],
    queryFn: ({ signal }) =>
      api.get<Interview[]>("/recruitment/interviews", { scope: "mine" }, signal),
  });

  if (interviews.isLoading) return <Skeleton className="h-48 w-full" />;

  const rows = interviews.data ?? [];
  const waiting = rows.filter((row) => !row.submittedAt);
  const done = rows.filter((row) => row.submittedAt);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No interviews for you"
        description="Rounds you are asked to sit on will appear here."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Waiting on you</CardTitle>
        </CardHeader>
        <CardContent>
          {waiting.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing outstanding.</p>
          ) : (
            <ul className="divide-border divide-y">
              {waiting.map((interview) => (
                <FeedbackRow key={interview.id} interview={interview} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {done.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Already submitted</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-border divide-y">
              {done.map((interview) => (
                <li key={interview.id} className="space-y-1 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {interview.application
                        ? candidateName(interview.application.candidate)
                        : "Candidate"}
                    </span>
                    <span className="text-muted-foreground">{interview.roundName}</span>
                    <Badge variant="secondary" className="ml-auto">
                      {RECOMMENDATION_LABEL[interview.recommendation ?? ""] ?? "Submitted"} ·{" "}
                      {interview.rating}/5
                    </Badge>
                  </div>
                  {interview.feedback ? (
                    <p className="text-muted-foreground">{interview.feedback}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function FeedbackRow({ interview }: { interview: Interview }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/recruitment/interviews/${interview.id}/feedback`, {
        rating: Number(rating),
        recommendation,
        feedback,
      }),
    onSuccess: () => {
      toast.success("Feedback submitted");
      void queryClient.invalidateQueries({ queryKey: ["recruitment"] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not submit"),
  });

  const complete = rating && recommendation && feedback.trim().length >= 10;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">
          {interview.application ? candidateName(interview.application.candidate) : "Candidate"}
        </span>
        <span className="text-muted-foreground">{interview.roundName}</span>
        {interview.application ? (
          <span className="text-muted-foreground">· {interview.application.jobPosting.title}</span>
        ) : null}
        <span className="text-muted-foreground ml-auto tabular-nums">
          {new Date(interview.scheduledAt).toLocaleString()}
        </span>
      </div>

      {open ? (
        <div className="grid gap-3 rounded-lg border p-3">
          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={`rating-${interview.id}`}>Rating</Label>
              <Select
                items={{ "1": "1", "2": "2", "3": "3", "4": "4", "5": "5" }}
                value={rating}
                onValueChange={(value) => setRating(value ?? "")}
              >
                <SelectTrigger id={`rating-${interview.id}`} className="w-full">
                  <SelectValue placeholder="1 to 5" />
                </SelectTrigger>
                <SelectContent>
                  {["1", "2", "3", "4", "5"].map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`rec-${interview.id}`}>Recommendation</Label>
              <Select
                items={RECOMMENDATION_LABEL}
                value={recommendation}
                onValueChange={(value) => setRecommendation(value ?? "")}
              >
                <SelectTrigger id={`rec-${interview.id}`} className="w-full">
                  <SelectValue placeholder="Would you hire them" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RECOMMENDATION_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`fb-${interview.id}`}>What happened</Label>
            <Textarea
              id={`fb-${interview.id}`}
              rows={3}
              value={feedback}
              placeholder="What you asked, how they answered, what you would want the next round to probe."
              onChange={(event) => setFeedback(event.target.value)}
            />
          </div>

          <div>
            <Button
              size="sm"
              disabled={submit.isPending || !complete}
              onClick={() => {
                setError(null);
                submit.mutate();
              }}
            >
              {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Submit
            </Button>
            <p className="text-muted-foreground mt-2 text-xs">
              Submitted once and not editable afterwards.
            </p>
          </div>
        </div>
      ) : (
        <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
          Give feedback
        </Button>
      )}
    </li>
  );
}

"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { useMyExits, useResign } from "@/hooks/use-checklists";

/**
 * Resigning, from the employee's own profile.
 *
 * Quiet by design: a small line at the bottom of a profile, not a button
 * anybody could hit by accident. Once one is filed the card turns into a
 * status — where the resignation has got to and what the last day is — because
 * from then on the question is no longer "how do I resign" but "what happens
 * now".
 */
export function ResignCard() {
  const exits = useMyExits();
  const [open, setOpen] = useState(false);

  const mine = (exits.data ?? []).filter((row) => !["completed", "cancelled"].includes(row.status));
  const current = mine[0];

  if (exits.isLoading) return null;

  if (current) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Your resignation
            <Badge variant="secondary" className="bg-info/12 text-info">
              {current.approvedAt ? "Approved" : "With your manager"}
            </Badge>
          </CardTitle>
          <CardDescription>
            {current.lastWorkingDay
              ? `Your last working day is ${current.lastWorkingDay.slice(0, 10)}.`
              : `You asked to leave by ${current.requestedLastWorkingDay.slice(0, 10)}. HR will confirm the date.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Anything you still need to do before you go appears on your overview. To withdraw this,
            speak to HR.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leaving</CardTitle>
        <CardDescription>
          If you are moving on, let us know here and your manager is asked to approve it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Resign
        </Button>
      </CardContent>

      <ResignDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}

function ResignDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const resign = useResign();
  const [reason, setReason] = useState("");
  const [lastDay, setLastDay] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resign</DialogTitle>
          <DialogDescription>
            This goes to your manager for approval, and then to HR to settle the date. Nothing
            changes until both have happened.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="resign-day">Your preferred last working day</Label>
            <Input
              id="resign-day"
              type="date"
              value={lastDay}
              onChange={(event) => setLastDay(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              A preference, not a decision — your notice period may put it later.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="resign-reason">Why are you leaving?</Label>
            <Textarea
              id="resign-reason"
              rows={3}
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={reason.trim().length === 0 || lastDay === "" || resign.isPending}
            onClick={() =>
              resign.mutate(
                { reason: reason.trim(), requestedLastWorkingDay: lastDay },
                {
                  onSuccess: () => {
                    toast.success("Sent to your manager");
                    onOpenChange(false);
                  },
                  onError: (error: unknown) =>
                    toast.error(
                      error instanceof Error ? error.message : "Could not file the resignation",
                    ),
                },
              )
            }
          >
            {resign.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Send it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

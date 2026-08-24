"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccountOptions, useLinkAccount } from "@/hooks/use-employees";

/**
 * Connect an existing login to this employee.
 *
 * For the account that was invited directly and so has no employee record.
 * Sending it another invite does not work — an account that has been signed
 * in to is active, and inviting an active account is refused — so without
 * this the person is stuck being told to ask HR, and HR has nothing to click.
 *
 * The list holds only accounts with no record of their own. Linking one that
 * had a person would take their attendance, leave and payslips with it.
 */
export function LinkAccountDialog({
  employeeId,
  employeeName,
  open,
  onOpenChange,
}: {
  employeeId: string;
  employeeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [userId, setUserId] = useState("");
  const accounts = useAccountOptions(open);
  const link = useLinkAccount(employeeId);

  const options = accounts.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link an account</DialogTitle>
          <DialogDescription>
            Connect a login that already exists to {employeeName}. They will see their profile the
            next time they open it.
          </DialogDescription>
        </DialogHeader>

        {accounts.isLoading ? (
          <p className="text-muted-foreground text-sm">Looking for accounts…</p>
        ) : options.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Every account already belongs to somebody. Send an invite instead — that creates one.
          </p>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="link-account">Account</Label>
            <Select
              items={Object.fromEntries(options.map((row) => [row.id, row.email]))}
              value={userId}
              onValueChange={(value) => setUserId(value ?? "")}
            >
              <SelectTrigger id="link-account" className="w-full">
                <SelectValue placeholder="Pick an account" />
              </SelectTrigger>
              <SelectContent>
                {options.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.email}
                    {row.status === "invited" ? " · not signed in yet" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!userId || link.isPending}
            onClick={() => {
              link.mutate(userId, {
                onSuccess: () => {
                  toast.success("Account linked");
                  setUserId("");
                  onOpenChange(false);
                },
                onError: (e: unknown) =>
                  toast.error(e instanceof Error ? e.message : "Could not link the account"),
              });
            }}
          >
            {link.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Link it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

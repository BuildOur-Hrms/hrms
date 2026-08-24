"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";

/**
 * The first thing somebody sees after accepting an invite.
 *
 * HR typed a name and a department to create the record and send the invite;
 * everything a person actually knows about themselves is still blank. This
 * asks for it once, in their own words, rather than leaving HR to chase it.
 *
 * Pre-filled with what HR entered, so the common case is confirming a name
 * and adding a phone number. Skipping is allowed and stamps the record all
 * the same — a prompt that cannot be dismissed is an obstacle, and somebody's
 * first morning is a bad time to meet one.
 */

interface Prefill {
  firstName: string;
  lastName: string | null;
  phone: string | null;
  personalEmail: string | null;
  address: string | null;
  dateOfBirth: string | null;
  gender: string | null;
}

const GENDERS: Record<string, string> = {
  female: "Female",
  male: "Male",
  other: "Other",
  undisclosed: "Prefer not to say",
};

export function CompleteProfile({ prefill }: { prefill: Prefill }) {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState(prefill.firstName);
  const [lastName, setLastName] = useState(prefill.lastName ?? "");
  const [phone, setPhone] = useState(prefill.phone ?? "");
  const [personalEmail, setPersonalEmail] = useState(prefill.personalEmail ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(prefill.dateOfBirth ?? "");
  const [gender, setGender] = useState(prefill.gender ?? "");
  const [address, setAddress] = useState(prefill.address ?? "");
  const [error, setError] = useState<string | null>(null);

  const finish = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/me/profile/complete", body),
    onSuccess: () => {
      toast.success("Thanks — you are all set");
      void queryClient.invalidateQueries();
      // A full reload: the shell shows the person's name, and it is read on
      // the server.
      window.location.reload();
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Could not save your details"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome — tell us about you</CardTitle>
        <CardDescription>
          Your details, in your own words. Your role, team and start date were set by HR and are on
          your profile once this is done.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          className="grid max-w-2xl gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            finish.mutate({
              firstName,
              lastName: lastName || null,
              phone: phone || null,
              personalEmail: personalEmail || null,
              dateOfBirth: dateOfBirth || null,
              gender: gender || null,
              address: address || null,
            });
          }}
        >
          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="cp-first">First name</Label>
              <Input
                id="cp-first"
                required
                maxLength={80}
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cp-last">Last name</Label>
              <Input
                id="cp-last"
                maxLength={80}
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="cp-phone">Phone</Label>
              <Input
                id="cp-phone"
                maxLength={30}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cp-personal">Personal email</Label>
              <Input
                id="cp-personal"
                type="email"
                maxLength={160}
                value={personalEmail}
                onChange={(event) => setPersonalEmail(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Somewhere we can reach you that is not your work address.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="cp-dob">Date of birth</Label>
              <Input
                id="cp-dob"
                type="date"
                value={dateOfBirth}
                onChange={(event) => setDateOfBirth(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cp-gender">Gender</Label>
              <Select
                items={GENDERS}
                value={gender}
                onValueChange={(value) => setGender(value ?? "")}
              >
                <SelectTrigger id="cp-gender" className="w-full">
                  <SelectValue placeholder="Rather not say" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(GENDERS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cp-address">Address</Label>
            <Textarea
              id="cp-address"
              rows={2}
              maxLength={2000}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={finish.isPending || firstName.trim().length === 0}>
              {finish.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Save and continue
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={finish.isPending}
              onClick={() => {
                setError(null);
                finish.mutate({});
              }}
            >
              Skip for now
            </Button>
          </div>

          <p className="text-muted-foreground text-xs">
            You can change any of this later from your profile. Emergency contacts are there too.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

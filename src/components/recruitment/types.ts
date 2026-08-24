/**
 * The shapes the recruitment screens read.
 *
 * Written out rather than inferred from the service, because these cross the
 * network: money arrives as a number (BigInt does not survive JSON) and dates
 * as `YYYY-MM-DD` strings, and a type that claimed otherwise would be lying
 * about what is actually in the response.
 */

export type Stage = "applied" | "screening" | "interview" | "offer" | "hired" | "rejected";
export type JobStatus = "draft" | "open" | "on_hold" | "closed";
export type OfferStatus = "draft" | "sent" | "accepted" | "declined" | "withdrawn";

export interface Job {
  id: string;
  title: string;
  employmentType: string;
  openings: number;
  description: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  status: JobStatus;
  department: { id: string; name: string };
  designation: { id: string; title: string };
  location: { id: string; name: string };
  _count?: { applications: number };
}

export interface JobDetail extends Job {
  funnel: Record<Stage, number>;
}

export interface Candidate {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  phone: string | null;
  source: string;
}

export interface ApplicationRow {
  id: string;
  stage: Stage;
  rejectionReason: string | null;
  appliedAt: string;
  hiredEmployeeId: string | null;
  candidate: Candidate;
  jobPosting: { id: string; title: string; status: JobStatus };
  _count?: { interviews: number; offers: number };
}

export interface Interview {
  id: string;
  roundName: string;
  scheduledAt: string;
  mode: string;
  rating: number | null;
  recommendation: string | null;
  feedback: string | null;
  submittedAt: string | null;
  interviewer: { id: string; firstName: string; lastName: string | null };
  application?: {
    id: string;
    stage: Stage;
    candidate: { id: string; firstName: string; lastName: string | null };
    jobPosting: { id: string; title: string };
  };
}

export interface Offer {
  id: string;
  ctc: number;
  joiningDate: string;
  expiryDate: string | null;
  status: OfferStatus;
  approvedAt: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  notes: string | null;
  designation: { id: string; title: string };
}

export interface ApplicationDetail extends ApplicationRow {
  interviews: Interview[];
  offers: Offer[];
}

export const STAGES: readonly Stage[] = [
  "applied",
  "screening",
  "interview",
  "offer",
  "hired",
  "rejected",
];

export const STAGE_LABEL: Record<Stage, string> = {
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
};

/**
 * Status colour, used only where it means a state.
 *
 * `hired` and `rejected` are outcomes and wear the status tokens; the rungs of
 * the ladder are neutral, because a candidate at `screening` is not in a worse
 * state than one at `interview` — they are simply earlier.
 */
export const STAGE_TINT: Record<Stage, string> = {
  applied: "bg-muted text-muted-foreground",
  screening: "bg-muted text-muted-foreground",
  interview: "bg-muted text-muted-foreground",
  offer: "bg-brand-soft text-brand-soft-foreground",
  hired: "bg-success/12 text-success",
  rejected: "bg-destructive/10 text-destructive",
};

export const OFFER_TINT: Record<OfferStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-info/12 text-info",
  accepted: "bg-success/12 text-success",
  declined: "bg-destructive/10 text-destructive",
  withdrawn: "bg-muted text-muted-foreground",
};

export const JOB_TINT: Record<JobStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  open: "bg-success/12 text-success",
  on_hold: "bg-warning/12 text-warning",
  closed: "bg-muted text-muted-foreground",
};

export const RECOMMENDATION_LABEL: Record<string, string> = {
  strong_yes: "Strong yes",
  yes: "Yes",
  no: "No",
  strong_no: "Strong no",
};

export function candidateName(candidate: { firstName: string; lastName: string | null }): string {
  return [candidate.firstName, candidate.lastName].filter(Boolean).join(" ");
}

/**
 * Minor units to something a person reads.
 *
 * No currency symbol: the company's currency lives on the company record and
 * the screens that show money already say which one. Guessing here would put
 * a rupee sign on a dollar figure.
 */
export function formatMoney(minor: number | null): string {
  if (minor === null) return "—";
  return (minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

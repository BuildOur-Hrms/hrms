import { z } from "zod";

import { queryBoolean } from "@/lib/validation";

/**
 * Shared by the API and the forms, like every other module: a field absent
 * from the schema cannot reach the database whatever the client sends
 * (docs/09-security.md §3).
 */

const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const instant = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Not a valid date and time");

/**
 * Money, in minor units.
 *
 * Coerced from a string as well as a number so a form can send `"1200000"`
 * without JavaScript quietly rounding it on the way — which is the entire
 * reason these are integers and not decimals.
 */
const minorUnits = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const employmentTypes = ["full_time", "part_time", "contract", "intern"] as const;

// ─────────────────────────────────────────────── job postings

/**
 * The fields of a posting, kept apart from the refinement so that both the
 * create and the update schema can be derived from one definition rather than
 * from each other.
 */
const jobFields = z.object({
  title: z.string().trim().min(3, "Say what the role is").max(160),
  departmentId: z.string().uuid("Choose a department"),
  designationId: z.string().uuid("Choose a designation"),
  locationId: z.string().uuid("Choose a location"),
  employmentType: z.enum(employmentTypes),
  openings: z.coerce.number().int().min(1).max(999).default(1),
  description: z.string().trim().max(20000).nullish(),
  salaryMin: minorUnits.nullish(),
  salaryMax: minorUnits.nullish(),
});

const bandIsOrdered = {
  message: "The lower end of the band cannot be above the upper end",
  path: ["salaryMax"],
};

export const createJobSchema = jobFields.refine(
  (v) => v.salaryMin == null || v.salaryMax == null || v.salaryMin <= v.salaryMax,
  bandIsOrdered,
);
export type CreateJobInput = z.infer<typeof createJobSchema>;

export const updateJobSchema = jobFields
  .partial()
  .refine(
    (v) => v.salaryMin == null || v.salaryMax == null || v.salaryMin <= v.salaryMax,
    bandIsOrdered,
  );
export type UpdateJobInput = z.infer<typeof updateJobSchema>;

export const jobStatusSchema = z.object({
  status: z.enum(["draft", "open", "on_hold", "closed"]),
});
export type JobStatusInput = z.infer<typeof jobStatusSchema>;

export const listJobsSchema = z.object({
  status: z.enum(["draft", "open", "on_hold", "closed"]).optional(),
  departmentId: z.string().uuid().optional(),
});
export type ListJobsInput = z.infer<typeof listJobsSchema>;

// ─────────────────────────────────────────────── candidates

export const createCandidateSchema = z.object({
  firstName: z.string().trim().min(1, "Required").max(80),
  lastName: z.string().trim().max(80).nullish(),
  email: z.string().trim().toLowerCase().email().max(160),
  phone: z.string().trim().max(30).nullish(),
  source: z.enum(["referral", "portal", "agency", "direct"]).default("direct"),
  notes: z.string().trim().max(5000).nullish(),
});
export type CreateCandidateInput = z.infer<typeof createCandidateSchema>;

export const updateCandidateSchema = createCandidateSchema.partial();
export type UpdateCandidateInput = z.infer<typeof updateCandidateSchema>;

export const listCandidatesSchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListCandidatesInput = z.infer<typeof listCandidatesSchema>;

// ─────────────────────────────────────────────── applications

export const createApplicationSchema = z.object({
  candidateId: z.string().uuid(),
  jobPostingId: z.string().uuid(),
});
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

/**
 * A rejection carries its reason in the same request that causes it.
 *
 * Not a follow-up edit: "why did we say no" is the field everyone skips when
 * it is optional, and the one everyone needs six months later.
 */
export const moveStageSchema = z
  .object({
    stage: z.enum(["applied", "screening", "interview", "offer", "rejected"]),
    rejectionReason: z.string().trim().max(2000).nullish(),
  })
  .refine((v) => v.stage !== "rejected" || (v.rejectionReason ?? "").trim().length >= 3, {
    message: "Say why this application was rejected",
    path: ["rejectionReason"],
  });
export type MoveStageInput = z.infer<typeof moveStageSchema>;

export const listApplicationsSchema = z.object({
  jobPostingId: z.string().uuid().optional(),
  candidateId: z.string().uuid().optional(),
  stage: z.enum(["applied", "screening", "interview", "offer", "hired", "rejected"]).optional(),
});
export type ListApplicationsInput = z.infer<typeof listApplicationsSchema>;

// ─────────────────────────────────────────────── interviews

export const scheduleInterviewSchema = z.object({
  applicationId: z.string().uuid(),
  roundName: z.string().trim().min(2, "Name the round").max(80),
  scheduledAt: instant,
  interviewerId: z.string().uuid("Choose an interviewer"),
  mode: z.enum(["onsite", "video", "phone"]).default("video"),
});
export type ScheduleInterviewInput = z.infer<typeof scheduleInterviewSchema>;

/**
 * Feedback arrives whole or not at all.
 *
 * A rating without a recommendation, or either without words, is the kind of
 * half-submitted verdict a panel argues about afterwards — so all three are
 * required together and the database checks the same thing.
 */
export const interviewFeedbackSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  recommendation: z.enum(["strong_yes", "yes", "no", "strong_no"]),
  feedback: z.string().trim().min(10, "Say what happened in the interview").max(5000),
});
export type InterviewFeedbackInput = z.infer<typeof interviewFeedbackSchema>;

export const listInterviewsSchema = z.object({
  /** `mine` is what this interviewer has been asked to sit on. */
  scope: z.enum(["mine", "all"]).default("mine"),
  applicationId: z.string().uuid().optional(),
  upcomingOnly: queryBoolean.default(false),
});
export type ListInterviewsInput = z.infer<typeof listInterviewsSchema>;

// ─────────────────────────────────────────────── offers

export const createOfferSchema = z
  .object({
    applicationId: z.string().uuid(),
    designationId: z.string().uuid("Choose a designation"),
    ctc: minorUnits.refine((value) => value > 0, "An offer needs a number on it"),
    joiningDate: dateOnly,
    expiryDate: dateOnly.nullish(),
    notes: z.string().trim().max(5000).nullish(),
  })
  .refine((v) => v.expiryDate == null || v.expiryDate <= v.joiningDate, {
    message: "An offer cannot expire after the day it starts",
    path: ["expiryDate"],
  });
export type CreateOfferInput = z.infer<typeof createOfferSchema>;

export const offerStatusSchema = z.object({
  status: z.enum(["sent", "accepted", "declined", "withdrawn"]),
  notes: z.string().trim().max(2000).nullish(),
});
export type OfferStatusInput = z.infer<typeof offerStatusSchema>;

export const listOffersSchema = z.object({
  status: z.enum(["draft", "sent", "accepted", "declined", "withdrawn"]).optional(),
  applicationId: z.string().uuid().optional(),
});
export type ListOffersInput = z.infer<typeof listOffersSchema>;

/**
 * Turning an accepted offer into a person.
 *
 * The offer already carries the designation, the joining date and the money.
 * What it cannot know is where in the org this person sits day to day, so
 * that is what is asked for here — and nothing else, because everything else
 * is already on the offer and re-asking would invite the two to disagree.
 */
export const convertSchema = z.object({
  departmentId: z.string().uuid("Choose a department"),
  locationId: z.string().uuid("Choose a location"),
  managerId: z.string().uuid().nullish(),
  /** Optional: an invite goes out only if asked for. */
  invite: z.coerce.boolean().default(false),
});
export type ConvertInput = z.infer<typeof convertSchema>;

export const idParamSchema = z.object({ id: z.string().uuid() });

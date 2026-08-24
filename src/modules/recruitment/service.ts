import type { RequestContext } from "@/lib/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";
import { fromDateOnly } from "@/lib/utils";

import {
  canMove,
  canSetOfferStatus,
  funnelOf,
  stageForOffer,
  type OfferStatus,
  type Stage,
} from "./pipeline";
import type {
  ConvertInput,
  CreateApplicationInput,
  CreateCandidateInput,
  CreateJobInput,
  CreateOfferInput,
  InterviewFeedbackInput,
  JobStatusInput,
  ListApplicationsInput,
  ListCandidatesInput,
  ListInterviewsInput,
  ListJobsInput,
  ListOffersInput,
  MoveStageInput,
  OfferStatusInput,
  ScheduleInterviewInput,
  UpdateCandidateInput,
  UpdateJobInput,
} from "./validators";

/**
 * Recruitment: postings, candidates, applications, interviews, offers, and
 * the conversion that ends the pipeline.
 *
 * Two rules run through the whole module.
 *
 * **Salary bands and offer amounts are internal.** They live on rows that only
 * `recruitment.view_all` reaches. An interviewer sees the person and the
 * round they are sitting on, never the money.
 *
 * **An offer cannot be sent by the person who wrote it alone.** Sending
 * requires `recruitment.approve`, and the approver is recorded on the row —
 * the database refuses an offer past draft that cannot say who signed it.
 */

const NOBODY = "00000000-0000-0000-0000-000000000000";

function actor(ctx: RequestContext): EventActor {
  return {
    userId: ctx.userId,
    companyId: ctx.companyId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    db: ctx.db,
  };
}

/** Whoever runs hiring. Everything below `view_all` is an interviewer. */
function isRecruiter(ctx: RequestContext): boolean {
  return ctx.permissions.has("recruitment.view_all") || ctx.permissions.has("recruitment.manage");
}

function assertRecruiter(ctx: RequestContext): void {
  if (!isRecruiter(ctx)) throw new ForbiddenError("You cannot manage hiring");
}

function assertCanEdit(ctx: RequestContext): void {
  if (!ctx.permissions.has("recruitment.edit") && !ctx.permissions.has("recruitment.manage")) {
    throw new ForbiddenError("You cannot change the hiring pipeline");
  }
}

/** `BigInt` does not survive `JSON.stringify`; money leaves as a number. */
function money(value: bigint | null): number | null {
  return value === null ? null : Number(value);
}

function isoDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

// ─────────────────────────────────────────────── job postings

const JOB_FIELDS = {
  id: true,
  title: true,
  employmentType: true,
  openings: true,
  description: true,
  salaryMin: true,
  salaryMax: true,
  status: true,
  closedAt: true,
  createdAt: true,
  department: { select: { id: true, name: true } },
  designation: { select: { id: true, title: true } },
  location: { select: { id: true, name: true } },
} as const;

type JobRow = {
  salaryMin: bigint | null;
  salaryMax: bigint | null;
  closedAt: Date | null;
} & Record<string, unknown>;

function presentJob<T extends JobRow>(row: T) {
  return {
    ...row,
    salaryMin: money(row.salaryMin),
    salaryMax: money(row.salaryMax),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  };
}

export async function listJobs(ctx: RequestContext, input: ListJobsInput) {
  assertRecruiter(ctx);

  const jobs = await ctx.db.jobPosting.findMany({
    where: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    select: { ...JOB_FIELDS, _count: { select: { applications: true } } },
  });

  return jobs.map(presentJob);
}

/** One job, with the funnel across its applications. */
export async function getJob(ctx: RequestContext, id: string) {
  assertRecruiter(ctx);

  const job = await ctx.db.jobPosting.findFirst({ where: { id }, select: JOB_FIELDS });
  if (!job) throw new NotFoundError("Job posting");

  const applications = await ctx.db.application.findMany({
    where: { jobPostingId: id },
    select: { stage: true },
  });

  return {
    ...presentJob(job),
    funnel: funnelOf(applications.map((row) => row.stage as Stage)),
  };
}

async function assertOrgRefs(
  ctx: RequestContext,
  input: { departmentId?: string; designationId?: string; locationId?: string },
): Promise<void> {
  const checks: Promise<void>[] = [];

  if (input.departmentId) {
    checks.push(
      ctx.db.department
        .findFirst({ where: { id: input.departmentId }, select: { id: true } })
        .then((row) => {
          if (!row) throw new NotFoundError("Department");
        }),
    );
  }
  if (input.designationId) {
    checks.push(
      ctx.db.designation
        .findFirst({ where: { id: input.designationId }, select: { id: true } })
        .then((row) => {
          if (!row) throw new NotFoundError("Designation");
        }),
    );
  }
  if (input.locationId) {
    checks.push(
      ctx.db.location
        .findFirst({ where: { id: input.locationId }, select: { id: true } })
        .then((row) => {
          if (!row) throw new NotFoundError("Location");
        }),
    );
  }
  await Promise.all(checks);
}

export async function createJob(ctx: RequestContext, input: CreateJobInput) {
  assertCanEdit(ctx);
  await assertOrgRefs(ctx, input);

  const job = await ctx.db.jobPosting.create({
    data: {
      companyId: ctx.companyId,
      createdBy: ctx.userId,
      title: input.title,
      departmentId: input.departmentId,
      designationId: input.designationId,
      locationId: input.locationId,
      employmentType: input.employmentType,
      openings: input.openings,
      description: input.description ?? null,
      salaryMin: input.salaryMin == null ? null : BigInt(input.salaryMin),
      salaryMax: input.salaryMax == null ? null : BigInt(input.salaryMax),
    },
    select: JOB_FIELDS,
  });

  await emit(
    "recruitment.job_changed",
    { jobPostingId: job.id, title: job.title, action: "created" },
    actor(ctx),
  );

  return presentJob(job);
}

export async function updateJob(ctx: RequestContext, id: string, input: UpdateJobInput) {
  assertCanEdit(ctx);

  const existing = await ctx.db.jobPosting.findFirst({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError("Job posting");

  await assertOrgRefs(ctx, input);

  const job = await ctx.db.jobPosting.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      ...(input.designationId !== undefined ? { designationId: input.designationId } : {}),
      ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
      ...(input.employmentType !== undefined ? { employmentType: input.employmentType } : {}),
      ...(input.openings !== undefined ? { openings: input.openings } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.salaryMin !== undefined
        ? { salaryMin: input.salaryMin == null ? null : BigInt(input.salaryMin) }
        : {}),
      ...(input.salaryMax !== undefined
        ? { salaryMax: input.salaryMax == null ? null : BigInt(input.salaryMax) }
        : {}),
    },
    select: JOB_FIELDS,
  });

  await emit(
    "recruitment.job_changed",
    { jobPostingId: id, title: job.title, action: "updated" },
    actor(ctx),
  );

  return presentJob(job);
}

export async function setJobStatus(ctx: RequestContext, id: string, input: JobStatusInput) {
  assertCanEdit(ctx);

  const existing = await ctx.db.jobPosting.findFirst({
    where: { id },
    select: { id: true, title: true, status: true },
  });
  if (!existing) throw new NotFoundError("Job posting");
  if (existing.status === input.status) {
    throw new ConflictError(`This job is already ${input.status}.`);
  }

  const job = await ctx.db.jobPosting.update({
    where: { id },
    data: {
      status: input.status,
      // Set once and cleared on reopening, so "when did we stop hiring for
      // this" survives the job being reopened later.
      closedAt: input.status === "closed" ? new Date() : null,
    },
    select: JOB_FIELDS,
  });

  await emit(
    "recruitment.job_changed",
    { jobPostingId: id, title: job.title, action: input.status },
    actor(ctx),
  );

  return presentJob(job);
}

// ─────────────────────────────────────────────── candidates

const CANDIDATE_FIELDS = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  source: true,
  resumeKey: true,
  notes: true,
  createdAt: true,
} as const;

export async function listCandidates(ctx: RequestContext, input: ListCandidatesInput) {
  assertRecruiter(ctx);

  const where = input.q
    ? {
        OR: [
          { firstName: { contains: input.q, mode: "insensitive" as const } },
          { lastName: { contains: input.q, mode: "insensitive" as const } },
          { email: { contains: input.q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [rows, total] = await Promise.all([
    ctx.db.candidate.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        ...CANDIDATE_FIELDS,
        applications: {
          select: {
            id: true,
            stage: true,
            jobPosting: { select: { id: true, title: true } },
          },
        },
      },
    }),
    ctx.db.candidate.count({ where }),
  ]);

  return { data: rows, meta: { page: input.page, pageSize: input.pageSize, total } };
}

export async function createCandidate(ctx: RequestContext, input: CreateCandidateInput) {
  assertCanEdit(ctx);

  // One row per person per company. A second is not a second candidate, it is
  // a split history of the same person — the thing a talent pool exists to
  // prevent.
  const clash = await ctx.db.candidate.findFirst({
    where: { email: input.email },
    select: { id: true },
  });
  if (clash) {
    throw new ConflictError(
      "Somebody with that email is already in the talent pool. Add an application to them instead.",
    );
  }

  const candidate = await ctx.db.candidate.create({
    data: {
      companyId: ctx.companyId,
      firstName: input.firstName,
      lastName: input.lastName ?? null,
      email: input.email,
      phone: input.phone ?? null,
      source: input.source,
      notes: input.notes ?? null,
    },
    select: CANDIDATE_FIELDS,
  });

  await emit(
    "recruitment.candidate_changed",
    { candidateId: candidate.id, email: candidate.email, action: "created" },
    actor(ctx),
  );

  return candidate;
}

export async function updateCandidate(
  ctx: RequestContext,
  id: string,
  input: UpdateCandidateInput,
) {
  assertCanEdit(ctx);

  const existing = await ctx.db.candidate.findFirst({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError("Candidate");

  const candidate = await ctx.db.candidate.update({
    where: { id },
    data: {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    select: CANDIDATE_FIELDS,
  });

  await emit(
    "recruitment.candidate_changed",
    { candidateId: id, email: candidate.email, action: "updated" },
    actor(ctx),
  );

  return candidate;
}

// ─────────────────────────────────────────────── applications

const APPLICATION_FIELDS = {
  id: true,
  stage: true,
  rejectionReason: true,
  appliedAt: true,
  hiredEmployeeId: true,
  candidate: {
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, source: true },
  },
  jobPosting: { select: { id: true, title: true, status: true } },
} as const;

export async function listApplications(ctx: RequestContext, input: ListApplicationsInput) {
  assertRecruiter(ctx);

  return ctx.db.application.findMany({
    where: {
      ...(input.jobPostingId ? { jobPostingId: input.jobPostingId } : {}),
      ...(input.candidateId ? { candidateId: input.candidateId } : {}),
      ...(input.stage ? { stage: input.stage } : {}),
    },
    orderBy: [{ stage: "asc" }, { appliedAt: "asc" }],
    take: 500,
    select: {
      ...APPLICATION_FIELDS,
      _count: { select: { interviews: true, offers: true } },
    },
  });
}

export async function getApplication(ctx: RequestContext, id: string) {
  assertRecruiter(ctx);

  const application = await ctx.db.application.findFirst({
    where: { id },
    select: {
      ...APPLICATION_FIELDS,
      interviews: {
        orderBy: { scheduledAt: "asc" },
        select: {
          id: true,
          roundName: true,
          scheduledAt: true,
          mode: true,
          rating: true,
          recommendation: true,
          feedback: true,
          submittedAt: true,
          interviewer: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      offers: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          ctc: true,
          joiningDate: true,
          expiryDate: true,
          status: true,
          approvedAt: true,
          sentAt: true,
          respondedAt: true,
          notes: true,
          designation: { select: { id: true, title: true } },
        },
      },
    },
  });
  if (!application) throw new NotFoundError("Application");

  return {
    ...application,
    offers: application.offers.map((offer) => ({
      ...offer,
      ctc: money(offer.ctc),
      joiningDate: isoDate(offer.joiningDate),
      expiryDate: isoDate(offer.expiryDate),
    })),
  };
}

export async function createApplication(ctx: RequestContext, input: CreateApplicationInput) {
  assertCanEdit(ctx);

  const [candidate, job] = await Promise.all([
    ctx.db.candidate.findFirst({ where: { id: input.candidateId }, select: { id: true } }),
    ctx.db.jobPosting.findFirst({
      where: { id: input.jobPostingId },
      select: { id: true, status: true, title: true },
    }),
  ]);
  if (!candidate) throw new NotFoundError("Candidate");
  if (!job) throw new NotFoundError("Job posting");

  if (job.status === "closed") {
    throw new ConflictError("That job is closed. Reopen it before adding candidates.");
  }

  const existing = await ctx.db.application.findFirst({
    where: { candidateId: input.candidateId, jobPostingId: input.jobPostingId },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError("That candidate has already applied to this job.");
  }

  const application = await ctx.db.application.create({
    data: {
      companyId: ctx.companyId,
      candidateId: input.candidateId,
      jobPostingId: input.jobPostingId,
    },
    select: APPLICATION_FIELDS,
  });

  await emit(
    "recruitment.application_moved",
    {
      applicationId: application.id,
      jobTitle: job.title,
      from: null,
      to: "applied",
      reason: null,
    },
    actor(ctx),
  );

  return application;
}

export async function moveStage(ctx: RequestContext, id: string, input: MoveStageInput) {
  assertCanEdit(ctx);

  const application = await ctx.db.application.findFirst({
    where: { id },
    select: { id: true, stage: true, jobPosting: { select: { title: true } } },
  });
  if (!application) throw new NotFoundError("Application");

  const from = application.stage as Stage;
  const to = input.stage as Stage;

  const verdict = canMove({ from, to });
  if (!verdict.ok) throw new ConflictError(verdict.reason);

  const updated = await ctx.db.application.update({
    where: { id },
    data: {
      stage: to,
      // Cleared on any move away from rejection, so a reopened application
      // does not carry the reason it was once turned down.
      rejectionReason: to === "rejected" ? (input.rejectionReason ?? null) : null,
    },
    select: APPLICATION_FIELDS,
  });

  await emit(
    "recruitment.application_moved",
    {
      applicationId: id,
      jobTitle: application.jobPosting.title,
      from,
      to,
      reason: to === "rejected" ? (input.rejectionReason ?? null) : null,
    },
    actor(ctx),
  );

  return updated;
}

// ─────────────────────────────────────────────── interviews

const INTERVIEW_FIELDS = {
  id: true,
  roundName: true,
  scheduledAt: true,
  mode: true,
  rating: true,
  recommendation: true,
  feedback: true,
  submittedAt: true,
  interviewer: { select: { id: true, firstName: true, lastName: true } },
  application: {
    select: {
      id: true,
      stage: true,
      candidate: { select: { id: true, firstName: true, lastName: true } },
      jobPosting: { select: { id: true, title: true } },
    },
  },
} as const;

/**
 * The interviews somebody is sitting on, or all of them.
 *
 * `mine` is the interviewer's view and needs no recruiting permission — being
 * asked to interview is what entitles you to see it. Money is not in the
 * selection at all, so an interviewer cannot read the band off the round they
 * were invited to.
 */
export async function listInterviews(ctx: RequestContext, input: ListInterviewsInput) {
  if (input.scope === "all") assertRecruiter(ctx);

  return ctx.db.interview.findMany({
    where: {
      ...(input.scope === "mine" ? { interviewerId: ctx.employeeId ?? NOBODY } : {}),
      ...(input.applicationId ? { applicationId: input.applicationId } : {}),
      ...(input.upcomingOnly ? { scheduledAt: { gte: new Date() } } : {}),
    },
    orderBy: { scheduledAt: "asc" },
    take: 200,
    select: INTERVIEW_FIELDS,
  });
}

export async function scheduleInterview(ctx: RequestContext, input: ScheduleInterviewInput) {
  assertCanEdit(ctx);

  const [application, interviewer] = await Promise.all([
    ctx.db.application.findFirst({
      where: { id: input.applicationId },
      select: { id: true, stage: true },
    }),
    ctx.db.employee.findFirst({ where: { id: input.interviewerId }, select: { id: true } }),
  ]);
  if (!application) throw new NotFoundError("Application");
  if (!interviewer) throw new NotFoundError("Interviewer");

  if (application.stage === "hired" || application.stage === "rejected") {
    throw new ConflictError("That application is closed. There is nothing left to interview for.");
  }

  const interview = await ctx.db.interview.create({
    data: {
      companyId: ctx.companyId,
      applicationId: input.applicationId,
      roundName: input.roundName,
      scheduledAt: new Date(input.scheduledAt),
      interviewerId: input.interviewerId,
      mode: input.mode,
    },
    select: INTERVIEW_FIELDS,
  });

  await emit(
    "recruitment.interview_scheduled",
    {
      interviewId: interview.id,
      applicationId: input.applicationId,
      interviewerId: input.interviewerId,
      scheduledAt: input.scheduledAt,
      roundName: input.roundName,
    },
    actor(ctx),
  );

  return interview;
}

/**
 * The interviewer's verdict.
 *
 * Only the person who sat the round may write it, or somebody who runs
 * hiring. And only once: feedback that can be revised after the panel has
 * discussed it is not independent feedback, which is the entire point of
 * collecting it separately.
 */
export async function submitFeedback(
  ctx: RequestContext,
  id: string,
  input: InterviewFeedbackInput,
) {
  const interview = await ctx.db.interview.findFirst({
    where: { id },
    select: { id: true, interviewerId: true, submittedAt: true, applicationId: true },
  });
  if (!interview) throw new NotFoundError("Interview");

  const isPanel = interview.interviewerId === ctx.employeeId;
  if (!isPanel && !isRecruiter(ctx)) {
    throw new ForbiddenError("Only the interviewer can give feedback on this round");
  }
  if (interview.submittedAt) {
    throw new ConflictError("Feedback for this round has already been submitted.");
  }

  const updated = await ctx.db.interview.update({
    where: { id },
    data: {
      rating: input.rating,
      recommendation: input.recommendation,
      feedback: input.feedback,
      submittedAt: new Date(),
    },
    select: INTERVIEW_FIELDS,
  });

  await emit(
    "recruitment.feedback_submitted",
    {
      interviewId: id,
      applicationId: interview.applicationId,
      rating: input.rating,
      recommendation: input.recommendation,
    },
    actor(ctx),
  );

  return updated;
}

// ─────────────────────────────────────────────── offers

const OFFER_FIELDS = {
  id: true,
  ctc: true,
  joiningDate: true,
  expiryDate: true,
  status: true,
  approvedAt: true,
  sentAt: true,
  respondedAt: true,
  notes: true,
  designation: { select: { id: true, title: true } },
  approver: { select: { id: true, email: true } },
  application: {
    select: {
      id: true,
      stage: true,
      candidate: { select: { id: true, firstName: true, lastName: true, email: true } },
      jobPosting: { select: { id: true, title: true } },
    },
  },
} as const;

type OfferRow = {
  ctc: bigint;
  joiningDate: Date;
  expiryDate: Date | null;
} & Record<string, unknown>;

function presentOffer<T extends OfferRow>(row: T) {
  return {
    ...row,
    ctc: money(row.ctc),
    joiningDate: isoDate(row.joiningDate),
    expiryDate: isoDate(row.expiryDate),
  };
}

export async function listOffers(ctx: RequestContext, input: ListOffersInput) {
  assertRecruiter(ctx);

  const offers = await ctx.db.offer.findMany({
    where: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.applicationId ? { applicationId: input.applicationId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: OFFER_FIELDS,
  });

  return offers.map(presentOffer);
}

export async function createOffer(ctx: RequestContext, input: CreateOfferInput) {
  assertCanEdit(ctx);

  const [application, designation] = await Promise.all([
    ctx.db.application.findFirst({
      where: { id: input.applicationId },
      select: { id: true, stage: true },
    }),
    ctx.db.designation.findFirst({ where: { id: input.designationId }, select: { id: true } }),
  ]);
  if (!application) throw new NotFoundError("Application");
  if (!designation) throw new NotFoundError("Designation");

  if (application.stage === "hired" || application.stage === "rejected") {
    throw new ConflictError("That application is closed.");
  }

  // One live offer at a time. Two open offers to the same person is a
  // question nobody wants asked in writing.
  const live = await ctx.db.offer.findFirst({
    where: { applicationId: input.applicationId, status: { in: ["draft", "sent"] } },
    select: { id: true },
  });
  if (live) {
    throw new ConflictError(
      "There is already an open offer on this application. Withdraw it before writing another.",
    );
  }

  const offer = await ctx.db.offer.create({
    data: {
      companyId: ctx.companyId,
      applicationId: input.applicationId,
      designationId: input.designationId,
      ctc: BigInt(input.ctc),
      joiningDate: fromDateOnly(input.joiningDate),
      expiryDate: input.expiryDate ? fromDateOnly(input.expiryDate) : null,
      notes: input.notes ?? null,
    },
    select: OFFER_FIELDS,
  });

  await emit(
    "recruitment.offer_changed",
    { offerId: offer.id, applicationId: input.applicationId, action: "drafted", ctc: input.ctc },
    actor(ctx),
  );

  return presentOffer(offer);
}

/**
 * Move an offer along.
 *
 * Sending is the gated step: it needs `recruitment.approve`, and the approver
 * is stamped on the row in the same write. The database refuses an offer past
 * draft that cannot name who signed it, so the gate cannot be skipped by any
 * other path into the table.
 */
export async function setOfferStatus(ctx: RequestContext, id: string, input: OfferStatusInput) {
  const offer = await ctx.db.offer.findFirst({
    where: { id },
    select: { id: true, status: true, applicationId: true, approvedBy: true },
  });
  if (!offer) throw new NotFoundError("Offer");

  const from = offer.status as OfferStatus;
  const to = input.status as OfferStatus;

  const verdict = canSetOfferStatus(from, to);
  if (!verdict.ok) throw new ConflictError(verdict.reason);

  if (to === "sent") {
    if (!ctx.permissions.has("recruitment.approve")) {
      throw new ForbiddenError("An offer has to be approved before it goes out");
    }
  } else {
    assertCanEdit(ctx);
  }

  const now = new Date();
  const stage = stageForOffer(to);

  const updated = await ctx.db.offer.update({
    where: { id },
    data: {
      status: to,
      ...(to === "sent" ? { approvedBy: ctx.userId, approvedAt: now, sentAt: now } : {}),
      ...(to === "accepted" || to === "declined" ? { respondedAt: now } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    select: OFFER_FIELDS,
  });

  // The application follows its offer in the same request, so the two can
  // never disagree about where this candidate stands.
  if (stage) {
    await ctx.db.application.update({
      where: { id: offer.applicationId },
      data: {
        stage,
        ...(stage === "rejected" ? { rejectionReason: "Offer declined" } : {}),
      },
    });
  }

  await emit(
    "recruitment.offer_changed",
    { offerId: id, applicationId: offer.applicationId, action: to, ctc: null },
    actor(ctx),
  );

  return presentOffer(updated);
}

// ─────────────────────────────────────────────── conversion

/**
 * An accepted offer becomes a person.
 *
 * The end of the pipeline, and the only way an application reaches `hired`.
 * Everything the offer already decided — designation, joining date — is
 * copied rather than re-asked, so the employee record and the offer cannot
 * disagree about what was agreed.
 *
 * The new employee lands in `onboarding`, not `active`. Somebody who has
 * accepted an offer has not yet been given a laptop or an account, and that
 * is what the onboarding checklist is for.
 */
export async function convertToEmployee(ctx: RequestContext, offerId: string, input: ConvertInput) {
  if (!ctx.permissions.has("employee.create")) {
    throw new ForbiddenError("You cannot create employee records");
  }
  assertCanEdit(ctx);

  const offer = await ctx.db.offer.findFirst({
    where: { id: offerId },
    select: {
      id: true,
      status: true,
      designationId: true,
      joiningDate: true,
      application: {
        select: {
          id: true,
          stage: true,
          hiredEmployeeId: true,
          candidate: {
            select: { id: true, firstName: true, lastName: true, email: true, phone: true },
          },
        },
      },
    },
  });
  if (!offer) throw new NotFoundError("Offer");

  if (offer.status !== "accepted") {
    throw new ConflictError("Only an accepted offer becomes an employee.");
  }
  if (offer.application.hiredEmployeeId) {
    throw new ConflictError("This application has already been converted.");
  }

  await assertOrgRefs(ctx, input);
  if (input.managerId) {
    const manager = await ctx.db.employee.findFirst({
      where: { id: input.managerId },
      select: { id: true },
    });
    if (!manager) throw new NotFoundError("Manager");
  }

  const candidate = offer.application.candidate;

  const clash = await ctx.db.employee.findFirst({
    where: { workEmail: candidate.email },
    select: { id: true },
  });
  if (clash) {
    throw new ConflictError("An employee already uses that work email.");
  }

  const employeeCode = await nextEmployeeCode(ctx);

  const employee = await ctx.db.employee.create({
    data: {
      companyId: ctx.companyId,
      employeeCode,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      workEmail: candidate.email,
      phone: candidate.phone,
      departmentId: input.departmentId,
      designationId: offer.designationId,
      locationId: input.locationId,
      managerId: input.managerId ?? null,
      employmentType: "full_time",
      status: "onboarding",
      joinDate: offer.joiningDate,
    },
    select: { id: true, employeeCode: true, firstName: true, lastName: true },
  });

  await ctx.db.application.update({
    where: { id: offer.application.id },
    data: { stage: "hired", hiredEmployeeId: employee.id },
  });

  await emit(
    "recruitment.converted",
    {
      applicationId: offer.application.id,
      offerId,
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      candidateEmail: candidate.email,
    },
    actor(ctx),
  );

  return { employee, applicationId: offer.application.id };
}

/**
 * The next `EMP0001`.
 *
 * The same advisory-lock approach the employees module uses, and for the same
 * reason: two simultaneous hires must be serialised before they collide, not
 * after, because a failed INSERT would poison the surrounding transaction.
 */
async function nextEmployeeCode(ctx: RequestContext): Promise<string> {
  await ctx.db.$executeRawUnsafe(
    `SELECT pg_advisory_xact_lock(hashtext($1 || ':employee_code'))`,
    ctx.companyId,
  );

  const rows = await ctx.db.$queryRawUnsafe<{ max: number | null }[]>(
    `SELECT MAX(NULLIF(regexp_replace(employee_code, '\\D', '', 'g'), '')::bigint) AS max
       FROM employees
      WHERE company_id = $1::uuid AND employee_code ~ '^EMP[0-9]+$'`,
    ctx.companyId,
  );

  const next = Number(rows[0]?.max ?? 0) + 1;
  return `EMP${String(next).padStart(4, "0")}`;
}

/** Guard against a caller reaching this module with no employee identity. */
export function assertHasEmployee(ctx: RequestContext): string {
  if (!ctx.employeeId) {
    throw new ValidationError("This account is not linked to an employee record.");
  }
  return ctx.employeeId;
}

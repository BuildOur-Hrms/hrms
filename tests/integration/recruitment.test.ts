import { beforeAll, describe, expect, it } from "vitest";

import { POST as createApplication } from "@/app/api/v1/recruitment/applications/route";
import { POST as moveStage } from "@/app/api/v1/recruitment/applications/[id]/stage/route";
import { GET as getApplication } from "@/app/api/v1/recruitment/applications/[id]/route";
import { POST as createCandidate } from "@/app/api/v1/recruitment/candidates/route";
import { POST as scheduleInterview } from "@/app/api/v1/recruitment/interviews/route";
import { GET as listInterviews } from "@/app/api/v1/recruitment/interviews/route";
import { POST as submitFeedback } from "@/app/api/v1/recruitment/interviews/[id]/feedback/route";
import { GET as getJob, PATCH as updateJob } from "@/app/api/v1/recruitment/jobs/[id]/route";
import { POST as setJobStatus } from "@/app/api/v1/recruitment/jobs/[id]/status/route";
import { GET as listJobs, POST as createJob } from "@/app/api/v1/recruitment/jobs/route";
import { POST as convert } from "@/app/api/v1/recruitment/offers/[id]/convert/route";
import { POST as setOfferStatus } from "@/app/api/v1/recruitment/offers/[id]/status/route";
import { POST as createOffer } from "@/app/api/v1/recruitment/offers/route";
import { withPlatform } from "@/lib/db";

import { call, seedTenants, type Persona, type Tenants } from "./harness";

/**
 * Hiring, end to end: a posting, a candidate, an application through the
 * stages, an interview with feedback, an offer that needs approving, and a
 * conversion that ends with somebody on the payroll.
 *
 * The assertions that matter are the refusals. An offer nobody approved, an
 * interviewer reading the salary band, a rejection with no reason — each one
 * is a thing this module exists to prevent.
 */

let t: Tenants;
let jobId: string;
let candidateId: string;
let applicationId: string;

async function post<T = unknown>(
  handler: Parameters<typeof call>[0],
  path: string,
  as: Persona,
  body: Record<string, unknown>,
  params?: Record<string, string>,
) {
  return call<T>(handler, path, { as, body, ...(params ? { params } : {}) });
}

beforeAll(async () => {
  t = await seedTenants();
});

describe("a job posting", () => {
  it("is created as a draft", async () => {
    const result = await post<{ id: string; status: string; salaryMin: number | null }>(
      createJob,
      "/api/v1/recruitment/jobs",
      t.acme.hr,
      {
        title: "Senior Engineer",
        departmentId: t.acme.departmentId,
        designationId: t.acme.designationId,
        locationId: t.acme.locationId,
        employmentType: "full_time",
        openings: 2,
        salaryMin: 1_800_000,
        salaryMax: 2_400_000,
      },
    );

    expect(result.status, result.error?.message).toBe(201);
    expect(result.data.status).toBe("draft");
    // Money survives the trip as a number, not a serialised BigInt.
    expect(result.data.salaryMin).toBe(1_800_000);
    jobId = result.data.id;
  });

  it("refuses a band that runs backwards", async () => {
    const result = await post(createJob, "/api/v1/recruitment/jobs", t.acme.hr, {
      title: "Backwards",
      departmentId: t.acme.departmentId,
      designationId: t.acme.designationId,
      locationId: t.acme.locationId,
      employmentType: "full_time",
      salaryMin: 9_000_000,
      salaryMax: 1_000_000,
    });

    expect(result.status).toBe(400);
  });

  it("opens for applications", async () => {
    const result = await post(
      setJobStatus,
      `/api/v1/recruitment/jobs/${jobId}/status`,
      t.acme.hr,
      { status: "open" },
      { id: jobId },
    );
    expect(result.status, result.error?.message).toBe(200);
  });

  it("is invisible to somebody who does not run hiring", async () => {
    const result = await call(listJobs, "/api/v1/recruitment/jobs", { as: t.acme.employee });
    expect(result.status).toBe(403);
  });
});

describe("the talent pool", () => {
  it("takes a candidate", async () => {
    const result = await post<{ id: string }>(
      createCandidate,
      "/api/v1/recruitment/candidates",
      t.acme.hr,
      { firstName: "Rue", lastName: "Nakamura", email: "rue@example.test", source: "referral" },
    );

    expect(result.status, result.error?.message).toBe(201);
    candidateId = result.data.id;
  });

  it("keeps one row per person, so their history does not split in two", async () => {
    const result = await post(createCandidate, "/api/v1/recruitment/candidates", t.acme.hr, {
      firstName: "Rue",
      lastName: "Again",
      email: "rue@example.test",
    });

    expect(result.status).toBe(409);
    expect(result.error?.message).toMatch(/talent pool/i);
  });
});

describe("an application", () => {
  it("starts at applied", async () => {
    const result = await post<{ id: string; stage: string }>(
      createApplication,
      "/api/v1/recruitment/applications",
      t.acme.hr,
      { candidateId, jobPostingId: jobId },
    );

    expect(result.status, result.error?.message).toBe(201);
    expect(result.data.stage).toBe("applied");
    applicationId = result.data.id;
  });

  it("cannot be duplicated for the same job", async () => {
    const result = await post(createApplication, "/api/v1/recruitment/applications", t.acme.hr, {
      candidateId,
      jobPostingId: jobId,
    });
    expect(result.status).toBe(409);
  });

  it("moves along the ladder", async () => {
    for (const stage of ["screening", "interview"]) {
      const result = await post(
        moveStage,
        `/api/v1/recruitment/applications/${applicationId}/stage`,
        t.acme.hr,
        { stage },
        { id: applicationId },
      );
      expect(result.status, `${stage}: ${result.error?.message}`).toBe(200);
    }
  });

  it("will not be rejected without a reason", async () => {
    const result = await post(
      moveStage,
      `/api/v1/recruitment/applications/${applicationId}/stage`,
      t.acme.hr,
      { stage: "rejected" },
      { id: applicationId },
    );

    expect(result.status).toBe(400);
    expect(JSON.stringify(result.error)).toMatch(/why this application was rejected/i);
  });

  it("will not be moved straight to hired", async () => {
    const result = await post(
      moveStage,
      `/api/v1/recruitment/applications/${applicationId}/stage`,
      t.acme.hr,
      { stage: "hired" },
      { id: applicationId },
    );
    // `hired` is not even in the schema for a move: it is what conversion
    // writes, so the stage and the employee record cannot disagree.
    expect(result.status).toBe(400);
  });
});

describe("interviews", () => {
  let interviewId: string;

  it("are scheduled onto an interviewer", async () => {
    const result = await post<{ id: string }>(
      scheduleInterview,
      "/api/v1/recruitment/interviews",
      t.acme.hr,
      {
        applicationId,
        roundName: "System design",
        scheduledAt: "2026-10-05T09:00:00.000Z",
        interviewerId: t.acme.manager.employeeId,
        mode: "video",
      },
    );

    expect(result.status, result.error?.message).toBe(201);
    interviewId = result.data.id;
  });

  it("show up for the interviewer without any recruiting permission", async () => {
    const result = await call<{ id: string }[]>(listInterviews, "/api/v1/recruitment/interviews", {
      as: t.acme.manager,
      query: { scope: "mine" },
    });

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.map((row) => row.id)).toContain(interviewId);
  });

  it("never carry the money with them", async () => {
    const result = await call(listInterviews, "/api/v1/recruitment/interviews", {
      as: t.acme.manager,
      query: { scope: "mine" },
    });

    // An interviewer sees the person and the round, never the band.
    const body = JSON.stringify(result.data);
    expect(body).not.toContain("salaryMin");
    expect(body).not.toContain("ctc");
  });

  it("refuse a manager asking to see every round in the company", async () => {
    const result = await call(listInterviews, "/api/v1/recruitment/interviews", {
      as: t.acme.manager,
      query: { scope: "all" },
    });
    expect(result.status).toBe(403);
  });

  it("take feedback from the person who sat the round", async () => {
    const result = await post(
      submitFeedback,
      `/api/v1/recruitment/interviews/${interviewId}/feedback`,
      t.acme.manager,
      { rating: 4, recommendation: "yes", feedback: "Strong on fundamentals, light on testing." },
      { id: interviewId },
    );
    expect(result.status, result.error?.message).toBe(200);
  });

  it("take it only once, so a panel cannot revise after discussing", async () => {
    const result = await post(
      submitFeedback,
      `/api/v1/recruitment/interviews/${interviewId}/feedback`,
      t.acme.manager,
      { rating: 1, recommendation: "no", feedback: "Changed my mind after the debrief." },
      { id: interviewId },
    );

    expect(result.status).toBe(409);
  });

  it("refuse feedback from somebody who was not on the panel", async () => {
    const another = await post<{ id: string }>(
      scheduleInterview,
      "/api/v1/recruitment/interviews",
      t.acme.hr,
      {
        applicationId,
        roundName: "Culture",
        scheduledAt: "2026-10-06T09:00:00.000Z",
        interviewerId: t.acme.manager.employeeId,
      },
    );

    const result = await post(
      submitFeedback,
      `/api/v1/recruitment/interviews/${another.data.id}/feedback`,
      t.acme.employee,
      { rating: 5, recommendation: "strong_yes", feedback: "I was not in this interview." },
      { id: another.data.id },
    );

    expect(result.status).toBe(403);
  });
});

describe("offers", () => {
  let offerId: string;

  it("start as drafts", async () => {
    const result = await post<{ id: string; status: string; ctc: number }>(
      createOffer,
      "/api/v1/recruitment/offers",
      t.acme.hr,
      {
        applicationId,
        designationId: t.acme.designationId,
        ctc: 2_200_000,
        joiningDate: "2026-11-02",
        expiryDate: "2026-10-20",
      },
    );

    expect(result.status, result.error?.message).toBe(201);
    expect(result.data.status).toBe("draft");
    expect(result.data.ctc).toBe(2_200_000);
    offerId = result.data.id;
  });

  it("allow only one open at a time on an application", async () => {
    const result = await post(createOffer, "/api/v1/recruitment/offers", t.acme.hr, {
      applicationId,
      designationId: t.acme.designationId,
      ctc: 2_500_000,
      joiningDate: "2026-11-02",
    });

    expect(result.status).toBe(409);
    expect(result.error?.message).toMatch(/already an open offer/i);
  });

  it("cannot be accepted before anybody sent them", async () => {
    const result = await post(
      setOfferStatus,
      `/api/v1/recruitment/offers/${offerId}/status`,
      t.acme.hr,
      { status: "accepted" },
      { id: offerId },
    );
    expect(result.status).toBe(409);
  });

  it("cannot be sent by somebody without the approval permission", async () => {
    const result = await post(
      setOfferStatus,
      `/api/v1/recruitment/offers/${offerId}/status`,
      t.acme.manager,
      { status: "sent" },
      { id: offerId },
    );
    expect(result.status).toBe(403);
  });

  it("record who approved them when they go out", async () => {
    const result = await post(
      setOfferStatus,
      `/api/v1/recruitment/offers/${offerId}/status`,
      t.acme.hr,
      { status: "sent" },
      { id: offerId },
    );
    expect(result.status, result.error?.message).toBe(200);

    const row = await withPlatform((db) =>
      db.offer.findFirstOrThrow({
        where: { id: offerId },
        select: { approvedBy: true, approvedAt: true, sentAt: true },
      }),
    );
    expect(row.approvedBy).toBe(t.acme.hr.userId);
    expect(row.approvedAt).not.toBeNull();
    expect(row.sentAt).not.toBeNull();
  });

  it("drag the application to the offer stage with them", async () => {
    const result = await call<{ stage: string }>(
      getApplication,
      `/api/v1/recruitment/applications/${applicationId}`,
      { as: t.acme.hr, params: { id: applicationId } },
    );
    expect(result.data.stage).toBe("offer");
  });

  it("are accepted, and then settled", async () => {
    const accept = await post(
      setOfferStatus,
      `/api/v1/recruitment/offers/${offerId}/status`,
      t.acme.hr,
      { status: "accepted" },
      { id: offerId },
    );
    expect(accept.status, accept.error?.message).toBe(200);

    const again = await post(
      setOfferStatus,
      `/api/v1/recruitment/offers/${offerId}/status`,
      t.acme.hr,
      { status: "withdrawn" },
      { id: offerId },
    );
    expect(again.status).toBe(409);
    expect(again.error?.message).toMatch(/settled/i);
  });

  describe("conversion", () => {
    it("creates the employee and closes the application", async () => {
      const result = await post<{ employee: { id: string; employeeCode: string } }>(
        convert,
        `/api/v1/recruitment/offers/${offerId}/convert`,
        t.acme.hr,
        { departmentId: t.acme.departmentId, locationId: t.acme.locationId },
        { id: offerId },
      );

      expect(result.status, result.error?.message).toBe(201);
      expect(result.data.employee.employeeCode).toMatch(/^EMP\d+$/);

      const employee = await withPlatform((db) =>
        db.employee.findFirstOrThrow({
          where: { id: result.data.employee.id },
          select: { status: true, workEmail: true, joinDate: true },
        }),
      );
      // Onboarding, not active: somebody who accepted an offer has not yet
      // been given a laptop or an account.
      expect(employee.status).toBe("onboarding");
      expect(employee.workEmail).toBe("rue@example.test");

      const application = await call<{ stage: string; hiredEmployeeId: string | null }>(
        getApplication,
        `/api/v1/recruitment/applications/${applicationId}`,
        { as: t.acme.hr, params: { id: applicationId } },
      );
      expect(application.data.stage).toBe("hired");
      expect(application.data.hiredEmployeeId).toBe(result.data.employee.id);
    });

    it("refuses to run twice", async () => {
      const result = await post(
        convert,
        `/api/v1/recruitment/offers/${offerId}/convert`,
        t.acme.hr,
        { departmentId: t.acme.departmentId, locationId: t.acme.locationId },
        { id: offerId },
      );
      expect(result.status).toBe(409);
    });

    it("leaves a hired application unmovable", async () => {
      const result = await post(
        moveStage,
        `/api/v1/recruitment/applications/${applicationId}/stage`,
        t.acme.hr,
        { stage: "screening" },
        { id: applicationId },
      );
      expect(result.status).toBe(409);
    });
  });
});

describe("across companies", () => {
  it("keeps one company's pipeline out of the other's", async () => {
    const acme = await call<unknown[]>(listJobs, "/api/v1/recruitment/jobs", { as: t.acme.hr });
    const globex = await call<unknown[]>(listJobs, "/api/v1/recruitment/jobs", {
      as: t.globex.hr,
    });

    expect(acme.data.length).toBeGreaterThan(0);
    expect(globex.data).toHaveLength(0);
  });

  it("will not let a job point at another company's department", async () => {
    const result = await post(createJob, "/api/v1/recruitment/jobs", t.acme.hr, {
      title: "Reaching across",
      departmentId: t.globex.departmentId,
      designationId: t.acme.designationId,
      locationId: t.acme.locationId,
      employmentType: "full_time",
    });
    expect(result.status).toBe(404);
  });

  it("refuses to read a foreign job by id", async () => {
    const result = await call(getJob, `/api/v1/recruitment/jobs/${jobId}`, {
      as: t.globex.hr,
      params: { id: jobId },
    });
    expect(result.status).toBe(404);
  });

  it("refuses to edit one", async () => {
    const result = await call(updateJob, `/api/v1/recruitment/jobs/${jobId}`, {
      as: t.globex.hr,
      method: "PATCH",
      params: { id: jobId },
      body: { title: "Renamed from outside" },
    });
    expect(result.status).toBe(404);
  });
});

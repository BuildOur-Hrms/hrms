import { describe, expect, it } from "vitest";

import {
  LADDER,
  canMove,
  canReopen,
  canSetOfferStatus,
  funnelOf,
  isTerminal,
  stageForOffer,
  type Stage,
} from "@/modules/recruitment/pipeline";

/**
 * The rules a hiring pipeline is judged on. Each one here is something a
 * recruiter will try on a Friday afternoon.
 */

describe("moving through the pipeline", () => {
  it("goes forward along the ladder", () => {
    for (const [index, from] of LADDER.entries()) {
      const to = LADDER[index + 1];
      if (!to) continue;
      expect(canMove({ from, to }).ok, `${from} → ${to}`).toBe(true);
    }
  });

  it("goes backward too, because panels really do send people back a round", () => {
    // Refusing would push people to reject and re-create, losing the
    // interviews, the feedback and the reason the conversation started.
    expect(canMove({ from: "offer", to: "interview" }).ok).toBe(true);
    expect(canMove({ from: "interview", to: "screening" }).ok).toBe(true);
  });

  it("skips ahead, since a strong candidate does not need every rung", () => {
    expect(canMove({ from: "applied", to: "offer" }).ok).toBe(true);
  });

  it("refuses a move to the stage it is already at", () => {
    expect(canMove({ from: "screening", to: "screening" }).ok).toBe(false);
  });

  it("rejects from anywhere that is not already an outcome", () => {
    for (const from of LADDER) {
      expect(canMove({ from, to: "rejected" }).ok, from).toBe(true);
    }
  });

  it("will not move an application that is already an outcome", () => {
    expect(canMove({ from: "hired", to: "offer" }).ok).toBe(false);
    expect(canMove({ from: "rejected", to: "interview" }).ok).toBe(false);
  });

  it("will not let anyone move an application to hired", () => {
    // Hiring is what conversion writes, so the stage and the employee record
    // cannot disagree about whether somebody was hired.
    const verdict = canMove({ from: "offer", to: "hired" });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/converting an accepted offer/i);
  });

  it("knows which stages are outcomes", () => {
    expect(isTerminal("hired")).toBe(true);
    expect(isTerminal("rejected")).toBe(true);
    for (const stage of LADDER) expect(isTerminal(stage)).toBe(false);
  });
});

describe("reopening", () => {
  it("puts a rejected application back on the ladder", () => {
    expect(canReopen("rejected", "screening").ok).toBe(true);
  });

  it("is not a way to undo a hire", () => {
    expect(canReopen("hired", "offer").ok).toBe(false);
  });

  it("will not reopen onto an outcome", () => {
    expect(canReopen("rejected", "hired").ok).toBe(false);
  });
});

describe("offers", () => {
  it("moves draft to sent, and sent to a decision", () => {
    expect(canSetOfferStatus("draft", "sent").ok).toBe(true);
    expect(canSetOfferStatus("sent", "accepted").ok).toBe(true);
    expect(canSetOfferStatus("sent", "declined").ok).toBe(true);
  });

  it("can be withdrawn before somebody answers, but not after", () => {
    expect(canSetOfferStatus("draft", "withdrawn").ok).toBe(true);
    expect(canSetOfferStatus("sent", "withdrawn").ok).toBe(true);
    expect(canSetOfferStatus("accepted", "withdrawn").ok).toBe(false);
  });

  it("will not accept an offer nobody was sent", () => {
    expect(canSetOfferStatus("draft", "accepted").ok).toBe(false);
  });

  it("treats a settled offer as settled", () => {
    for (const from of ["accepted", "declined", "withdrawn"] as const) {
      const verdict = canSetOfferStatus(from, "sent");
      expect(verdict.ok, from).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toMatch(/settled/i);
    }
  });
});

describe("keeping the application in step with its offer", () => {
  it("puts it at offer when one is sent or accepted", () => {
    expect(stageForOffer("sent")).toBe("offer");
    expect(stageForOffer("accepted")).toBe("offer");
  });

  it("rejects the application when the offer is declined", () => {
    expect(stageForOffer("declined")).toBe("rejected");
  });

  it("leaves it alone for a draft or a withdrawal", () => {
    // A withdrawn offer does not decide anything about the candidate; the
    // company may still want them for something else.
    expect(stageForOffer("draft")).toBeNull();
    expect(stageForOffer("withdrawn")).toBeNull();
  });
});

describe("the funnel", () => {
  it("counts each application once, where it stands now", () => {
    const stages: Stage[] = ["applied", "applied", "screening", "offer", "hired", "rejected"];
    expect(funnelOf(stages)).toEqual({
      applied: 2,
      screening: 1,
      interview: 0,
      offer: 1,
      hired: 1,
      rejected: 1,
    });
  });

  it("is all zeroes for a job nobody has applied to", () => {
    expect(funnelOf([])).toEqual({
      applied: 0,
      screening: 0,
      interview: 0,
      offer: 0,
      hired: 0,
      rejected: 0,
    });
  });
});

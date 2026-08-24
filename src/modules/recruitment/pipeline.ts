/**
 * The hiring pipeline as a state machine, and nothing else.
 *
 * Pure and free of the database, because these are the rules people argue
 * about — whether a candidate can go back a round, whether an offer can be
 * sent before anybody approved it — and an argument is easier to settle
 * against a list than against a service method.
 */

export type Stage = "applied" | "screening" | "interview" | "offer" | "hired" | "rejected";

/** The ladder, in order. `hired` and `rejected` are outcomes, not rungs. */
export const LADDER: readonly Stage[] = ["applied", "screening", "interview", "offer"];

export const TERMINAL: readonly Stage[] = ["hired", "rejected"];

export function isTerminal(stage: Stage): boolean {
  return TERMINAL.includes(stage);
}

export interface StageMove {
  from: Stage;
  to: Stage;
}

export type MoveVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Whether a stage change is allowed.
 *
 * Backwards along the ladder is allowed on purpose. Panels really do send
 * somebody back a round, and refusing would push people to reject and
 * re-create the application — which loses the interviews, the feedback and
 * the reason the conversation started.
 *
 * `hired` is not reachable by moving. It is what conversion writes once an
 * accepted offer becomes a person on the payroll, so that the stage and the
 * employee record can never disagree about whether somebody was hired.
 */
export function canMove({ from, to }: StageMove): MoveVerdict {
  if (from === to) return { ok: false, reason: "That application is already at this stage." };

  if (isTerminal(from)) {
    return {
      ok: false,
      reason:
        from === "hired"
          ? "This application ended in a hire and cannot be moved."
          : "This application was rejected. Reopen it by moving it back to a stage explicitly.",
    };
  }

  if (to === "hired") {
    return {
      ok: false,
      reason: "An application becomes a hire by converting an accepted offer, not by moving it.",
    };
  }

  // Rejection is reachable from anywhere that is not already an outcome. It
  // is the only sideways move, and the reason is required alongside it.
  if (to === "rejected") return { ok: true };

  if (!LADDER.includes(to)) return { ok: false, reason: "Unknown stage." };

  return { ok: true };
}

/** Reopening a rejected application, which is a deliberate act rather than a move. */
export function canReopen(from: Stage, to: Stage): MoveVerdict {
  if (from !== "rejected") return { ok: false, reason: "Only a rejected application is reopened." };
  if (!LADDER.includes(to)) return { ok: false, reason: "Reopen it onto a stage in the pipeline." };
  return { ok: true };
}

// ─────────────────────────────────────────────── offers

export type OfferStatus = "draft" | "sent" | "accepted" | "declined" | "withdrawn";

const OFFER_TRANSITIONS: Record<OfferStatus, readonly OfferStatus[]> = {
  // Sending is gated on approval; the service checks the permission, and the
  // database checks that an approver was recorded.
  draft: ["sent", "withdrawn"],
  sent: ["accepted", "declined", "withdrawn"],
  accepted: [],
  declined: [],
  withdrawn: [],
};

export function canSetOfferStatus(from: OfferStatus, to: OfferStatus): MoveVerdict {
  if (from === to) return { ok: false, reason: `This offer is already ${from}.` };

  if (!OFFER_TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      reason:
        OFFER_TRANSITIONS[from].length === 0
          ? `An offer that was ${from} is settled and cannot change.`
          : `An offer that is ${from} can only become ${OFFER_TRANSITIONS[from].join(" or ")}.`,
    };
  }
  return { ok: true };
}

/**
 * The stage an application should sit at once its offer reaches a status.
 *
 * Returned rather than applied, so the caller writes both in one transaction
 * and the two can never drift — an accepted offer against an application
 * still sitting in `interview` is the kind of inconsistency nobody notices
 * until a report is wrong.
 */
export function stageForOffer(status: OfferStatus): Stage | null {
  if (status === "sent" || status === "accepted") return "offer";
  if (status === "declined") return "rejected";
  return null;
}

// ─────────────────────────────────────────────── the funnel

export interface FunnelCounts {
  applied: number;
  screening: number;
  interview: number;
  offer: number;
  hired: number;
  rejected: number;
}

/**
 * How many are at each stage right now.
 *
 * A snapshot, not a history: somebody who reached `offer` is counted only
 * there, not also under `screening`. Cumulative funnels need the stage
 * transitions recorded over time, which is R10's job in the full report
 * catalog.
 */
export function funnelOf(stages: readonly Stage[]): FunnelCounts {
  const counts: FunnelCounts = {
    applied: 0,
    screening: 0,
    interview: 0,
    offer: 0,
    hired: 0,
    rejected: 0,
  };
  for (const stage of stages) counts[stage] += 1;
  return counts;
}

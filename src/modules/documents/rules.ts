/**
 * Who may see which document, with nothing to connect to.
 *
 * The whole module turns on one distinction. A manager may see a report's
 * training certificate and may not see their passport, and that difference is
 * a property of the *kind* of document rather than of the document — so it is
 * decided once per category and read here, instead of being remembered by
 * whoever uploads.
 *
 * Everything is expressed as "what may this viewer do with this document",
 * because the alternative — scattering the rule across a list query, a
 * download handler and a delete handler — is how the three come to disagree.
 */

export type DocumentStatus = "pending" | "active" | "expired" | "archived";

export interface Viewer {
  employeeId: string | null;
  /** From `resolveScope(ctx, "documents")`. */
  scope: "all" | "team" | "own" | "none";
  canManage: boolean;
}

export interface DocumentFacts {
  /** Null for a company document, which everybody may read. */
  employeeId: string | null;
  /** The manager of the person it belongs to, at the time of asking. */
  ownerManagerId: string | null;
  categoryManagerVisible: boolean;
  status: DocumentStatus;
}

/**
 * Whether this viewer may see that a document exists at all.
 *
 * A company document is readable by everybody; that is what makes it a
 * company document. Anything else is the person's own, their manager's if the
 * category allows it, or HR's.
 */
export function canRead(viewer: Viewer, document: DocumentFacts): boolean {
  if (viewer.scope === "none") return false;

  // A row whose bytes never arrived is nobody's business but the uploader's,
  // and even they only need it long enough to finish the upload.
  if (document.status === "pending" && !viewer.canManage) return false;

  if (document.employeeId === null) return true;
  if (viewer.scope === "all") return true;

  const mine = viewer.employeeId !== null && document.employeeId === viewer.employeeId;
  if (mine) return true;

  const theirManager = viewer.employeeId !== null && document.ownerManagerId === viewer.employeeId;

  return viewer.scope === "team" && theirManager && document.categoryManagerVisible;
}

/**
 * Whether this viewer may put a document here.
 *
 * Somebody may upload into their own file, if the category allows it — a
 * category HR issues from, like a contract, is not one an employee fills in
 * for themselves. Everything else needs the permission to manage documents,
 * including company-level documents, which are the handbook and the policies.
 */
export function canUpload(
  viewer: Viewer,
  target: { employeeId: string | null; categoryEmployeeUploadable: boolean },
): boolean {
  if (viewer.canManage) return true;
  if (target.employeeId === null) return false;

  const mine = viewer.employeeId !== null && target.employeeId === viewer.employeeId;
  return mine && target.categoryEmployeeUploadable;
}

/**
 * Whether this viewer may archive or replace one.
 *
 * Narrower than uploading on purpose. Somebody may add a certificate to their
 * own file; taking one out again is HR's, because a document store people can
 * quietly empty is not a record of anything.
 */
export function canArchive(viewer: Viewer): boolean {
  return viewer.canManage;
}

/**
 * How close a document is to expiring, in days.
 *
 * Negative once it has passed. Plain calendar arithmetic in UTC, because an
 * expiry is a date rather than a moment.
 */
export function daysUntil(expiry: string, today: string): number {
  const end = Date.parse(`${expiry}T00:00:00.000Z`);
  const now = Date.parse(`${today}T00:00:00.000Z`);
  return Math.round((end - now) / 86_400_000);
}

/** The run-ups at which somebody is told a document is about to lapse. */
export const EXPIRY_NOTICE_DAYS = [30, 7, 0] as const;

/**
 * Whether today is one of the days a warning goes out.
 *
 * Exact matches only. A range would send the same warning every day for a
 * month, and a notification people learn to dismiss is worse than none —
 * they dismiss the one that mattered along with the other twenty-nine.
 */
export function isNoticeDay(expiry: string, today: string): boolean {
  const left = daysUntil(expiry, today);
  return (EXPIRY_NOTICE_DAYS as readonly number[]).includes(left);
}

/** Whether a document has lapsed and should no longer read as current. */
export function hasExpired(expiry: string, today: string): boolean {
  return daysUntil(expiry, today) < 0;
}

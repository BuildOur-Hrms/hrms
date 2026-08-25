import { describe, expect, it } from "vitest";

import {
  canArchive,
  canRead,
  canUpload,
  daysUntil,
  hasExpired,
  isNoticeDay,
  type DocumentFacts,
  type Viewer,
} from "@/modules/documents/rules";

/**
 * Who may see what, argued about here rather than in production.
 */

const HR: Viewer = { employeeId: "hr", scope: "all", canManage: true };
const MANAGER: Viewer = { employeeId: "manager", scope: "team", canManage: false };
const OWNER: Viewer = { employeeId: "owner", scope: "own", canManage: false };
const STRANGER: Viewer = { employeeId: "stranger", scope: "own", canManage: false };

const passport: DocumentFacts = {
  employeeId: "owner",
  ownerManagerId: "manager",
  categoryManagerVisible: false,
  status: "active",
};

const certificate: DocumentFacts = { ...passport, categoryManagerVisible: true };

const handbook: DocumentFacts = {
  employeeId: null,
  ownerManagerId: null,
  categoryManagerVisible: false,
  status: "active",
};

describe("reading a document", () => {
  it("lets the person it belongs to read it", () => {
    expect(canRead(OWNER, passport)).toBe(true);
  });

  it("lets HR read anything", () => {
    expect(canRead(HR, passport)).toBe(true);
  });

  it("keeps a colleague out", () => {
    expect(canRead(STRANGER, passport)).toBe(false);
  });

  it("keeps a manager out of an identity document", () => {
    // The whole point of the module: a manager may see some of a report's
    // file and not the rest, and which is which is a property of the kind.
    expect(canRead(MANAGER, passport)).toBe(false);
  });

  it("lets a manager see a work document of the same person", () => {
    expect(canRead(MANAGER, certificate)).toBe(true);
  });

  it("keeps a manager out of somebody else's work document", () => {
    const notTheirs: DocumentFacts = { ...certificate, ownerManagerId: "another-manager" };
    expect(canRead(MANAGER, notTheirs)).toBe(false);
  });

  it("shows a company document to everybody", () => {
    expect(canRead(OWNER, handbook)).toBe(true);
    expect(canRead(MANAGER, handbook)).toBe(true);
    expect(canRead(STRANGER, handbook)).toBe(true);
  });

  it("shows nothing at all to somebody with no document access", () => {
    const none: Viewer = { employeeId: "x", scope: "none", canManage: false };
    expect(canRead(none, handbook)).toBe(false);
    expect(canRead(none, passport)).toBe(false);
  });

  it("hides a row whose bytes never arrived", () => {
    // A pending row is an upload somebody started and abandoned. It is not a
    // document yet, and listing it as one would be a lie with a name on it.
    const pending: DocumentFacts = { ...passport, status: "pending" };
    expect(canRead(OWNER, pending)).toBe(false);
    expect(canRead(HR, pending)).toBe(true);
  });

  it("still shows an expired document to the person it belongs to", () => {
    // Expired is not hidden. "Your visa lapsed in March" is exactly the thing
    // somebody needs to be able to see.
    const expired: DocumentFacts = { ...passport, status: "expired" };
    expect(canRead(OWNER, expired)).toBe(true);
  });
});

describe("uploading", () => {
  it("lets somebody add to their own file where the category allows it", () => {
    expect(canUpload(OWNER, { employeeId: "owner", categoryEmployeeUploadable: true })).toBe(true);
  });

  it("refuses a category HR issues from", () => {
    // A contract somebody uploaded for themselves is not a contract.
    expect(canUpload(OWNER, { employeeId: "owner", categoryEmployeeUploadable: false })).toBe(
      false,
    );
  });

  it("refuses somebody else's file, however open the category", () => {
    expect(canUpload(OWNER, { employeeId: "another", categoryEmployeeUploadable: true })).toBe(
      false,
    );
  });

  it("refuses a company document to anybody but HR", () => {
    expect(canUpload(OWNER, { employeeId: null, categoryEmployeeUploadable: true })).toBe(false);
    expect(canUpload(MANAGER, { employeeId: null, categoryEmployeeUploadable: true })).toBe(false);
    expect(canUpload(HR, { employeeId: null, categoryEmployeeUploadable: false })).toBe(true);
  });

  it("does not let a manager upload into a report's file", () => {
    // Seeing a document and putting one there are different things.
    expect(canUpload(MANAGER, { employeeId: "owner", categoryEmployeeUploadable: true })).toBe(
      false,
    );
  });
});

describe("archiving", () => {
  it("is HR's alone", () => {
    // Somebody may add a certificate to their own file; taking one out is not
    // theirs, or the store records nothing.
    expect(canArchive(HR)).toBe(true);
    expect(canArchive(OWNER)).toBe(false);
    expect(canArchive(MANAGER)).toBe(false);
  });
});

describe("expiry arithmetic", () => {
  it("counts the days left", () => {
    expect(daysUntil("2027-03-31", "2027-03-01")).toBe(30);
    expect(daysUntil("2027-03-02", "2027-03-01")).toBe(1);
  });

  it("counts zero on the day itself", () => {
    expect(daysUntil("2027-03-01", "2027-03-01")).toBe(0);
  });

  it("goes negative once it has passed", () => {
    expect(daysUntil("2027-02-28", "2027-03-01")).toBe(-1);
  });

  it("does not drift across a daylight-saving boundary", () => {
    expect(daysUntil("2027-03-29", "2027-03-28")).toBe(1);
    expect(daysUntil("2027-10-25", "2027-10-24")).toBe(1);
  });

  it("crosses a leap February", () => {
    expect(daysUntil("2028-03-01", "2028-02-28")).toBe(2);
  });
});

describe("when a warning goes out", () => {
  it("warns at thirty days, seven days, and on the day", () => {
    expect(isNoticeDay("2027-03-31", "2027-03-01")).toBe(true);
    expect(isNoticeDay("2027-03-08", "2027-03-01")).toBe(true);
    expect(isNoticeDay("2027-03-01", "2027-03-01")).toBe(true);
  });

  it("says nothing on the days in between", () => {
    // A range would send the same warning for a month, and a notification
    // people learn to dismiss takes the one that mattered with it.
    expect(isNoticeDay("2027-03-20", "2027-03-01")).toBe(false);
    expect(isNoticeDay("2027-03-05", "2027-03-01")).toBe(false);
  });

  it("says nothing once it has already lapsed", () => {
    expect(isNoticeDay("2027-02-01", "2027-03-01")).toBe(false);
  });
});

describe("expiring", () => {
  it("is not expired on the day itself", () => {
    // A document valid until the 31st is valid on the 31st.
    expect(hasExpired("2027-03-31", "2027-03-31")).toBe(false);
  });

  it("is expired the day after", () => {
    expect(hasExpired("2027-03-31", "2027-04-01")).toBe(true);
  });
});

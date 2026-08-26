import type { RequestContext } from "@/lib/context";
import { list } from "@/lib/api";
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";
import { resolveScope } from "@/lib/permissions";
import { storage } from "@/lib/storage";
import {
  bytesMatchType,
  buildKey,
  checkUpload,
  displayFilename,
  UPLOAD_POLICY,
} from "@/lib/storage/policy";
import { fromDateOnly } from "@/lib/utils";

import { canArchive, canRead, canReplace, canUpload, hasExpired, type Viewer } from "./rules";
import type {
  CategoryInput,
  ListDocumentsInput,
  RequestUploadInput,
  UpdateCategoryInput,
  UpdateDocumentInput,
} from "./validators";

/**
 * Documents, connected to storage and the database.
 *
 * Uploading is two steps, and the second one is not a formality. A presigned
 * URL lets the browser write straight to the bucket, which is the only way a
 * twenty-megabyte file gets there without passing through a function — but it
 * also means nothing verified the bytes. So the row is created `pending`, the
 * browser uploads, and confirming reads the stored object back and checks its
 * first bytes actually are what was declared. A file that is not what it said
 * is deleted rather than left orphaned in the bucket.
 */

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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Stands in for "this account has no employee record".
 *
 * It has to be a well-formed uuid: these values go into filters against
 * `employee_id`, and Postgres does not compare an empty string to a uuid
 * column — it raises, which turns "you own nothing" into a 500. The zero uuid
 * matches no row, which is the answer that was wanted.
 */
const NOBODY = "00000000-0000-0000-0000-000000000000";

function viewerOf(ctx: RequestContext): Viewer {
  return {
    employeeId: ctx.employeeId,
    scope: resolveScope(ctx, "documents"),
    canManage: resolveScope(ctx, "documents") === "all",
  };
}

const DOCUMENT_FIELDS = {
  id: true,
  employeeId: true,
  categoryId: true,
  name: true,
  contentType: true,
  sizeBytes: true,
  expiryDate: true,
  status: true,
  verifiedAt: true,
  createdAt: true,
  category: {
    select: {
      id: true,
      code: true,
      name: true,
      managerVisible: true,
      employeeUploadable: true,
      expiryRequired: true,
    },
  },
  employee: {
    select: { id: true, firstName: true, lastName: true, employeeCode: true, managerId: true },
  },
} as const;

// ─────────────────────────────────────────────── categories

export async function listCategories(ctx: RequestContext) {
  return ctx.db.documentCategory.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      employeeUploadable: true,
      managerVisible: true,
      expiryRequired: true,
      sortOrder: true,
    },
  });
}

export async function createCategory(ctx: RequestContext, input: CategoryInput) {
  const clash = await ctx.db.documentCategory.findFirst({
    where: { code: input.code, deletedAt: null },
    select: { id: true },
  });
  if (clash) throw new ConflictError("A category with that code already exists");

  const category = await ctx.db.documentCategory.create({
    data: { companyId: ctx.companyId, ...input },
    select: { id: true, code: true, name: true },
  });

  await emit(
    "document.category_saved",
    { categoryId: category.id, code: category.code },
    actor(ctx),
  );
  return category;
}

export async function updateCategory(ctx: RequestContext, id: string, input: UpdateCategoryInput) {
  const category = await ctx.db.documentCategory.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!category) throw new NotFoundError("Category");

  const updated = await ctx.db.documentCategory.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.employeeUploadable === undefined
        ? {}
        : { employeeUploadable: input.employeeUploadable }),
      ...(input.managerVisible === undefined ? {} : { managerVisible: input.managerVisible }),
      ...(input.expiryRequired === undefined ? {} : { expiryRequired: input.expiryRequired }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
    },
    select: { id: true, code: true, name: true },
  });

  await emit("document.category_saved", { categoryId: id, code: updated.code }, actor(ctx));
  return updated;
}

// ─────────────────────────────────────────────── uploading

/**
 * Somewhere to put a file, and a row waiting for it.
 *
 * Everything that can be refused is refused here — the category, the size,
 * the type, who is uploading into whose file — because after this point a URL
 * exists that will accept bytes.
 */
export async function requestUpload(ctx: RequestContext, input: RequestUploadInput) {
  const category = await ctx.db.documentCategory.findFirst({
    where: { id: input.categoryId, deletedAt: null },
    select: { id: true, employeeUploadable: true, expiryRequired: true, name: true },
  });
  if (!category) throw new NotFoundError("Category");

  const employeeId = input.employeeId ?? null;

  if (
    !canUpload(viewerOf(ctx), {
      employeeId,
      categoryEmployeeUploadable: category.employeeUploadable,
    })
  ) {
    throw new ForbiddenError("documents.manage");
  }

  if (employeeId) {
    const employee = await ctx.db.employee.findFirst({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundError("Employee");
  }

  if (category.expiryRequired && !input.expiryDate) {
    throw new BusinessRuleError(`${category.name} needs an expiry date.`, {
      rule: "expiry_required",
    });
  }

  const allowed = checkUpload({
    category: "document",
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });
  if (!allowed.ok) {
    throw new BusinessRuleError(allowed.reason, { rule: "upload_not_allowed" });
  }

  /*
   * What this upload supersedes, checked here rather than at confirm.
   *
   * Confirming archives whatever this points at, so an unchecked id is a way
   * to archive any document in the company without ever holding the
   * permission to archive one. It is settled now, while there is still a
   * request to refuse — by the time the bytes land the decision has been made.
   */
  let replacesId: string | null = null;
  if (input.replacesId) {
    const replaced = await ctx.db.document.findFirst({
      where: { id: input.replacesId },
      select: { id: true, employeeId: true, categoryId: true },
    });
    // Not found and not allowed are the same answer on purpose: telling the
    // two apart turns this into a way to ask whether a document id exists.
    if (
      !replaced ||
      !canReplace(viewerOf(ctx), replaced, {
        employeeId,
        categoryId: category.id,
        categoryEmployeeUploadable: category.employeeUploadable,
      })
    ) {
      throw new NotFoundError("Document");
    }
    replacesId = replaced.id;
  }

  // The key is built entirely by the server: nothing the caller sent appears
  // in it, which is what makes traversal impossible rather than filtered.
  const key = buildKey("document", ctx.companyId, employeeId ?? "company", input.contentType);

  const document = await ctx.db.document.create({
    data: {
      companyId: ctx.companyId,
      employeeId,
      categoryId: category.id,
      name: input.name,
      fileKey: key,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      expiryDate: input.expiryDate ? fromDateOnly(input.expiryDate) : null,
      status: "pending",
      uploadedBy: ctx.userId,
      replacesId,
    },
    select: { id: true, fileKey: true },
  });

  const uploadUrl = await storage.presignUpload(
    key,
    input.contentType,
    UPLOAD_POLICY.document.maxBytes,
  );

  return {
    documentId: document.id,
    uploadUrl,
    // What the browser must send, so a mismatch fails at the bucket rather
    // than silently storing something the signature did not cover.
    contentType: input.contentType,
    filename: displayFilename(input.filename),
  };
}

/**
 * Finish an upload, and check that what arrived is what was promised.
 *
 * The declared content type was a claim by whoever asked for the URL. An
 * executable renamed to `.pdf` arrives with `application/pdf` on it and is
 * still an executable, so the stored bytes get the final word — and a file
 * that fails is removed rather than left in the bucket with no row pointing
 * at it.
 */
export async function confirmUpload(ctx: RequestContext, id: string) {
  const document = await ctx.db.document.findFirst({
    where: { id },
    select: { id: true, fileKey: true, contentType: true, status: true, uploadedBy: true },
  });
  if (!document) throw new NotFoundError("Document");

  if (document.status !== "pending") {
    throw new BusinessRuleError("That upload has already been confirmed.", {
      rule: "already_confirmed",
    });
  }
  if (document.uploadedBy !== ctx.userId && resolveScope(ctx, "documents") !== "all") {
    throw new NotFoundError("Document");
  }

  let bytes: Buffer;
  try {
    bytes = await storage.get(document.fileKey);
  } catch {
    throw new BusinessRuleError("The file did not arrive. Try uploading it again.", {
      rule: "file_missing",
    });
  }

  /*
   * The policy, applied to the bytes rather than to the claim.
   *
   * `requestUpload` checked a size the caller stated, and the presigned PUT
   * does not enforce one — `Content-Length` rides in the query string and is
   * not a signed header, so S3 ignores it. This is the first point at which
   * anybody knows how big the file really is, which makes it the only place
   * the ceiling can be applied.
   */
  const arrived = checkUpload({
    category: "document",
    contentType: document.contentType,
    sizeBytes: bytes.byteLength,
  });

  if (!bytesMatchType(bytes, document.contentType) || !arrived.ok) {
    /*
     * Reported rather than thrown, and the difference matters.
     *
     * The handler runs inside the request's transaction, so throwing here
     * would roll the cleanup back — leaving the row behind while the file it
     * points at had already gone from storage, which is worse than either
     * outcome on its own. Returning lets both land, and the route turns this
     * into the 422 a throw would have produced.
     */
    await storage.remove(document.fileKey).catch(() => undefined);
    await ctx.db.document.delete({ where: { id } });
    return {
      rejected: true as const,
      reason: arrived.ok ? "That file is not the type it claims to be." : arrived.reason,
    };
  }

  const updated = await ctx.db.document.update({
    where: { id },
    data: { status: "active", sizeBytes: bytes.byteLength },
    select: { ...DOCUMENT_FIELDS, replacesId: true },
  });

  // A replacement archives what it replaces, rather than deleting it: last
  // year's contract is still the contract that was in force last year. The
  // right to do this was settled in `requestUpload`; what is left here is to
  // say so in the trail, because an archive nobody can attribute is how a
  // record quietly loses a document.
  if (updated.replacesId) {
    const archived = await ctx.db.document.updateMany({
      where: { id: updated.replacesId, status: { not: "archived" } },
      data: { status: "archived" },
    });
    if (archived.count > 0) {
      await emit(
        "document.archived",
        { documentId: updated.replacesId, replacedBy: id },
        actor(ctx),
      );
    }
  }

  await emit(
    "document.uploaded",
    { documentId: id, employeeId: updated.employeeId, categoryId: updated.categoryId },
    actor(ctx),
  );
  return { rejected: false as const, document: updated };
}

// ─────────────────────────────────────────────── reading

/**
 * What `canRead` says, written as a query.
 *
 * This used to be left to the pure rule alone, on the reasoning that two
 * copies of a rule about identity papers is one too many. The trouble is
 * that filtering in memory happens *after* the database has already chosen
 * which rows to return: a page of twenty, or a cap of five hundred, is filled
 * with rows the caller may not see and then emptied again. The count is wrong
 * for the same reason.
 *
 * So the rule is expressed here as well, and `canRead` stays as the check
 * that catches the day the two disagree. Where they must agree is documented
 * on `canRead` itself.
 */
function visibleToViewer(viewer: Viewer, me: string): Record<string, unknown> | null {
  if (viewer.scope === "all") return null;

  const or: Record<string, unknown>[] = [{ employeeId: null }, { employeeId: me }];
  if (viewer.scope === "team") {
    // A report's certificate, and only if the category is one managers see.
    or.push({ employee: { managerId: me }, category: { managerVisible: true } });
  }

  // A row whose bytes never arrived is nobody's business but HR's.
  return { OR: or, status: { not: "pending" } };
}

/**
 * The documents this caller may see, one page at a time.
 */
export async function listDocuments(ctx: RequestContext, input: ListDocumentsInput) {
  const viewer = viewerOf(ctx);
  if (viewer.scope === "none") throw new ForbiddenError("documents.view_own");

  const me = ctx.employeeId ?? NOBODY;

  const and: Record<string, unknown>[] = [
    ...(input.categoryId ? [{ categoryId: input.categoryId }] : []),
    ...(input.includeArchived ? [] : [{ status: { not: "archived" } }]),
  ];

  const visible = visibleToViewer(viewer, me);
  if (visible) and.push(visible);

  if (input.companyOnly) {
    and.push({ employeeId: null });
  } else if (input.mine) {
    and.push({ employeeId: me });
  } else if (input.employeeId) {
    // Honoured whatever the scope. Narrowing to one person cannot widen what
    // that person's documents are; `visible` has already said which they are.
    and.push({ employeeId: input.employeeId });
  }

  if (input.expiringWithinDays) {
    /*
     * A window, not a ceiling.
     *
     * Without the near edge this asks "expires before some future date",
     * which every document that lapsed years ago also satisfies — so a
     * renewals screen fills up with dead paper presented as urgent.
     */
    const from = fromDateOnly(today());
    const until = fromDateOnly(today());
    until.setUTCDate(until.getUTCDate() + input.expiringWithinDays);
    and.push({ expiryDate: { gte: from, lte: until } });
  }

  const where = and.length > 0 ? { AND: and } : {};

  const [rows, total] = await Promise.all([
    ctx.db.document.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: DOCUMENT_FIELDS,
    }),
    ctx.db.document.count({ where }),
  ]);

  const data = rows.filter((row) =>
    canRead(viewer, {
      employeeId: row.employeeId,
      ownerManagerId: row.employee?.managerId ?? null,
      categoryManagerVisible: row.category.managerVisible,
      status: row.status,
    }),
  );

  return list(data, { page: input.page, pageSize: input.pageSize, total });
}

async function loadReadable(ctx: RequestContext, id: string) {
  const document = await ctx.db.document.findFirst({
    where: { id },
    select: { ...DOCUMENT_FIELDS, fileKey: true },
  });
  if (!document) throw new NotFoundError("Document");

  const allowed = canRead(viewerOf(ctx), {
    employeeId: document.employeeId,
    ownerManagerId: document.employee?.managerId ?? null,
    categoryManagerVisible: document.category.managerVisible,
    status: document.status,
  });
  if (!allowed) throw new NotFoundError("Document");

  return document;
}

export async function getDocument(ctx: RequestContext, id: string) {
  const document = await loadReadable(ctx, id);
  // The storage key never leaves the server. It is not a secret on its own —
  // reads are signed — but handing it out invites somebody to try it.
  const withoutKey: Record<string, unknown> = { ...document };
  delete withoutKey["fileKey"];
  return withoutKey;
}

/**
 * A short-lived link to the file itself.
 *
 * The permission check happens here, on the server, and the URL it returns
 * lasts minutes. A link that outlived the check would be a document store
 * with a back door in it.
 */
export async function downloadUrl(ctx: RequestContext, id: string) {
  const document = await loadReadable(ctx, id);

  if (document.status === "pending") {
    throw new BusinessRuleError("That upload was never finished.", { rule: "upload_incomplete" });
  }

  const url = await storage.presignDownload(document.fileKey, document.name);

  await emit(
    "document.downloaded",
    { documentId: id, employeeId: document.employeeId },
    actor(ctx),
  );
  return { url, name: document.name, contentType: document.contentType };
}

// ─────────────────────────────────────────────── changing

export async function updateDocument(ctx: RequestContext, id: string, input: UpdateDocumentInput) {
  const existing = await loadReadable(ctx, id);

  if (!canArchive(viewerOf(ctx))) throw new ForbiddenError("documents.manage");

  /*
   * The same rule the upload had to satisfy.
   *
   * `requestUpload` refuses a document in one of these categories without a
   * date on it; without the matching guard here, clearing the date afterwards
   * is a one-request way around it, and a visa with no expiry is a visa
   * nobody will ever chase.
   */
  if (input.expiryDate !== undefined && !input.expiryDate && existing.category.expiryRequired) {
    throw new BusinessRuleError(`${existing.category.name} needs an expiry date.`, {
      rule: "expiry_required",
    });
  }

  const updated = await ctx.db.document.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.expiryDate === undefined
        ? {}
        : { expiryDate: input.expiryDate ? fromDateOnly(input.expiryDate) : null }),
      ...(input.verified === undefined
        ? {}
        : input.verified
          ? { verifiedBy: ctx.userId, verifiedAt: new Date() }
          : { verifiedBy: null, verifiedAt: null }),
    },
    select: DOCUMENT_FIELDS,
  });

  /*
   * An expiry moved into the future brings a lapsed document back; moved into
   * the past it takes it out. Either way the status follows the date rather
   * than waiting for tonight's sweep to notice.
   *
   * Only between those two states, though. `pending` means the bytes were
   * never confirmed and so never checked against the type they claimed, and
   * a row promoted out of it by a date change would have skipped that check
   * entirely — while `confirmUpload` would then refuse the real file as
   * already confirmed.
   */
  if (
    input.expiryDate !== undefined &&
    (updated.status === "active" || updated.status === "expired")
  ) {
    const stale = updated.expiryDate
      ? hasExpired(updated.expiryDate.toISOString().slice(0, 10), today())
      : false;
    const should = stale ? "expired" : "active";
    if (should !== updated.status) {
      await ctx.db.document.update({ where: { id }, data: { status: should } });
      updated.status = should;
    }
  }

  await emit("document.updated", { documentId: id }, actor(ctx));
  return updated;
}

/**
 * Take a document out of circulation.
 *
 * Archived, not deleted, and the file stays in the bucket. A document store
 * whose contents can be made to have never existed is not a record — and the
 * one time somebody needs last year's contract is the one time it matters.
 */
export async function archiveDocument(ctx: RequestContext, id: string) {
  await loadReadable(ctx, id);
  if (!canArchive(viewerOf(ctx))) throw new ForbiddenError("documents.manage");

  await ctx.db.document.update({ where: { id }, data: { status: "archived" } });
  await emit("document.archived", { documentId: id }, actor(ctx));
  return { id, status: "archived" };
}

// The nightly sweep and its notices live in `./expiry`, which the
// document-expiry cron calls once per company per day.

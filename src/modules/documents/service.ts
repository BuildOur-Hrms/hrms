import type { RequestContext } from "@/lib/context";
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

import { canArchive, canRead, canUpload, hasExpired, type Viewer } from "./rules";
import type {
  CategoryInput,
  ListDocumentsInput,
  RequestUploadInput,
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
    select: { id: true, code: true, name: true, managerVisible: true, employeeUploadable: true },
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

export async function updateCategory(
  ctx: RequestContext,
  id: string,
  input: Partial<CategoryInput>,
) {
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
      replacesId: input.replacesId ?? null,
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

  if (!bytesMatchType(bytes, document.contentType)) {
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
      reason: "That file is not the type it claims to be.",
    };
  }

  const updated = await ctx.db.document.update({
    where: { id },
    data: { status: "active", sizeBytes: bytes.byteLength },
    select: { ...DOCUMENT_FIELDS, replacesId: true },
  });

  // A replacement archives what it replaces, rather than deleting it: last
  // year's contract is still the contract that was in force last year.
  if (updated.replacesId) {
    await ctx.db.document.updateMany({
      where: { id: updated.replacesId, status: { not: "archived" } },
      data: { status: "archived" },
    });
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
 * The documents this caller may see.
 *
 * Scope narrows the query, and the pure rule decides each row — the query
 * cannot express "a manager may see this category and not that one" without
 * duplicating the rule in SQL, and two copies of a rule about identity papers
 * is one too many.
 */
export async function listDocuments(ctx: RequestContext, input: ListDocumentsInput) {
  const viewer = viewerOf(ctx);
  if (viewer.scope === "none") throw new ForbiddenError("documents.view_own");

  const me = ctx.employeeId ?? "";

  const where: Record<string, unknown> = {
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    ...(input.includeArchived ? {} : { status: { not: "archived" } }),
  };

  if (input.companyOnly) {
    where["employeeId"] = null;
  } else if (input.mine) {
    where["employeeId"] = me;
  } else if (viewer.scope === "all") {
    if (input.employeeId) where["employeeId"] = input.employeeId;
  } else if (viewer.scope === "team") {
    where["OR"] = [{ employeeId: null }, { employeeId: me }, { employee: { managerId: me } }];
  } else {
    where["OR"] = [{ employeeId: null }, { employeeId: me }];
  }

  if (input.expiringWithinDays) {
    const until = new Date();
    until.setUTCDate(until.getUTCDate() + input.expiringWithinDays);
    where["expiryDate"] = { not: null, lte: until };
  }

  const rows = await ctx.db.document.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: 500,
    select: DOCUMENT_FIELDS,
  });

  return rows.filter((row) =>
    canRead(viewer, {
      employeeId: row.employeeId,
      ownerManagerId: row.employee?.managerId ?? null,
      categoryManagerVisible: row.category.managerVisible,
      status: row.status,
    }),
  );
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
  await loadReadable(ctx, id);

  if (!canArchive(viewerOf(ctx))) throw new ForbiddenError("documents.manage");

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

  // An expiry moved into the future brings a lapsed document back; moved into
  // the past it takes it out. Either way the status follows the date rather
  // than waiting for tonight's sweep to notice.
  if (input.expiryDate !== undefined && updated.status !== "archived") {
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

/**
 * The nightly sweep: flip anything that has lapsed.
 *
 * Separate from the notice run because they answer different questions —
 * "is this still valid" is a fact about the document, and "does anybody need
 * telling" is a fact about the day.
 */
export async function expireDocuments(ctx: RequestContext, on: string): Promise<number> {
  const boundary = fromDateOnly(on);

  const result = await ctx.db.document.updateMany({
    where: { status: "active", expiryDate: { not: null, lt: boundary } },
    data: { status: "expired" },
  });

  return result.count;
}

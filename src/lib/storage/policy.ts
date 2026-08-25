import { randomUUID } from "node:crypto";

/**
 * What may be uploaded, where it is stored, and how the two are decided
 * (docs/09-security.md §5).
 *
 * Pure on purpose. Everything here is a rule about bytes and strings, and
 * every one of them is a rule an attacker will try: the object key is
 * server-generated so path traversal is impossible by construction, the
 * content type is checked against the bytes rather than the claim, and the
 * size cap is signed into the upload rather than checked afterwards.
 */

export type UploadCategory = "employee-photo" | "company-logo" | "leave-attachment" | "document";

export interface CategoryPolicy {
  /** Path segment in the object key. */
  module: string;
  mimeTypes: readonly string[];
  maxBytes: number;
  /** Re-encoded server-side to drop metadata. Photos carry GPS otherwise. */
  stripMetadata: boolean;
}

const MB = 1024 * 1024;

export const UPLOAD_POLICY: Record<UploadCategory, CategoryPolicy> = {
  "employee-photo": {
    module: "employees",
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 5 * MB,
    stripMetadata: true,
  },
  "company-logo": {
    // No SVG. It is a document format that can carry script, and a logo is
    // rendered on every page of the app including the sign-in screen.
    module: "company",
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 2 * MB,
    stripMetadata: true,
  },
  "leave-attachment": {
    module: "leave",
    mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
    maxBytes: 10 * MB,
    stripMetadata: false,
  },
  /**
   * Contracts, certificates, identity papers, policies.
   *
   * The widest of these lists and still narrow: a document store that accepts
   * anything becomes the easiest way to get a file onto the company's storage
   * and hand somebody a link to it.
   */
  document: {
    module: "documents",
    mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
    maxBytes: 20 * MB,
    stripMetadata: false,
  },
};

export function isUploadCategory(value: string): value is UploadCategory {
  return value in UPLOAD_POLICY;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * The object key, generated entirely by the server.
 *
 * `{companyId}/{module}/{entityId}/{uuid}.{ext}` — nothing the caller sent
 * appears in it, which is what makes traversal impossible rather than merely
 * filtered. The company id leading the key also means a misconfigured bucket
 * policy can still be written per tenant.
 */
export function buildKey(
  category: UploadCategory,
  companyId: string,
  entityId: string,
  contentType: string,
): string {
  const { module } = UPLOAD_POLICY[category];
  const extension = EXTENSIONS[contentType] ?? "bin";
  return `${companyId}/${module}/${entityId}/${randomUUID()}.${extension}`;
}

/**
 * The caller's filename, kept only as a label.
 *
 * Never part of the key — this is what gets shown next to a download so the
 * person recognises their own file. Stripped of directories and of anything
 * that would let it escape a header or a filesystem if someone later used it
 * as more than a label.
 */
export function displayFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "file";
  const safe = base
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    // Trim the punctuation off both ends, so a name made entirely of it falls
    // back to something readable rather than to a single dash.
    .replace(/^[.\-\s]+|[.\-\s]+$/g, "");
  return safe.slice(0, 120) || "file";
}

export interface UploadRequest {
  category: UploadCategory;
  contentType: string;
  sizeBytes: number;
}

export type PolicyFailure = { ok: false; reason: string };
export type PolicyPass = { ok: true; policy: CategoryPolicy };

/** Checked before anything is signed, so an oversized file is never offered a URL. */
export function checkUpload(request: UploadRequest): PolicyPass | PolicyFailure {
  const policy = UPLOAD_POLICY[request.category];
  if (!policy) return { ok: false, reason: "Unknown upload category" };

  if (!policy.mimeTypes.includes(request.contentType)) {
    return {
      ok: false,
      reason: `That file type is not accepted here. Allowed: ${policy.mimeTypes.join(", ")}.`,
    };
  }
  if (request.sizeBytes <= 0) return { ok: false, reason: "That file is empty." };
  if (request.sizeBytes > policy.maxBytes) {
    return {
      ok: false,
      reason: `That file is larger than ${Math.round(policy.maxBytes / MB)} MB.`,
    };
  }
  return { ok: true, policy };
}

/**
 * What the first bytes say the file actually is.
 *
 * The declared content type is a claim by whoever is uploading. An executable
 * renamed to `.pdf` arrives with `application/pdf` on it and is still an
 * executable, so the bytes get the final word.
 */
export function sniffContentType(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) => signature.every((b, i) => bytes[i] === b);

  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  // RIFF....WEBP
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    [8, 9, 10, 11].every((i, k) => bytes[i] === "WEBP".charCodeAt(k))
  ) {
    return "image/webp";
  }
  return null;
}

/** True when the bytes agree with the declared type. */
export function bytesMatchType(bytes: Uint8Array, contentType: string): boolean {
  const sniffed = sniffContentType(bytes);
  return sniffed !== null && sniffed === contentType;
}

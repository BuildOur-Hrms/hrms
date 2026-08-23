import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";

import { env, isProd } from "../env";
import { logger } from "../logger";

import { presignS3Url } from "./sigv4";

/**
 * Object storage, provider-agnostic — the same shape as the mailer, for the
 * same reason: one interface, a real driver for production and a local one so
 * the whole flow can be exercised without an account anywhere.
 *
 * Buckets are private and nothing is ever served from them directly. Reads go
 * through a presigned URL with a short life, and every one of them is preceded
 * by a permission check in the service that asked for it — the signature
 * proves the URL was issued, not that the person holding it should have it.
 *
 * docs/09-security.md §5.
 */

export interface Storage {
  readonly name: string;
  /** A URL the browser may PUT to directly, with the type and size signed in. */
  presignUpload(key: string, contentType: string, maxBytes: number): Promise<string>;
  /** A short-lived URL for reading one object. */
  presignDownload(key: string, filename?: string): Promise<string>;
  /** Server-side write, for bytes that were processed before storing. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const UPLOAD_TTL_SECONDS = 10 * 60;
const DOWNLOAD_TTL_SECONDS = 5 * 60;

// ─────────────────────────────────────────────── local

/**
 * Files under `.storage/`, for development.
 *
 * Deliberately not a stand-in for a bucket: there is no signing, the "URLs"
 * point back at the app, and on any host with an ephemeral filesystem the
 * files disappear with the process. It exists so an upload flow can be built
 * and tested before anyone has provisioned storage, exactly as
 * `EMAIL_PROVIDER=console` lets invites be built before anyone has a mail
 * domain — and like that one, it complains if it finds itself in production.
 */
const LOCAL_ROOT = resolve(process.cwd(), ".storage");
let warnedAboutLocalInProd = false;

/**
 * Resolve a key inside the local root, or refuse.
 *
 * Keys are server-generated and cannot contain traversal, but this is the
 * place where a string becomes a filesystem path, and a check here costs
 * nothing.
 */
function localPath(key: string): string {
  const full = normalize(join(LOCAL_ROOT, key));
  if (full !== LOCAL_ROOT && !full.startsWith(LOCAL_ROOT + sep)) {
    throw new Error("Refusing a storage key that escapes the storage root");
  }
  return full;
}

function warnIfProd(): void {
  if (isProd && !warnedAboutLocalInProd) {
    warnedAboutLocalInProd = true;
    logger.error(
      "STORAGE_PROVIDER=local in production — uploaded files are being written to a filesystem that will not survive a deploy",
    );
  }
}

const localStorage: Storage = {
  name: "local",

  async presignUpload(key) {
    warnIfProd();
    // No signature to give: the local route authenticates the session instead.
    return `${env.APP_URL}/api/v1/files/${encodeURI(key)}`;
  },

  async presignDownload(key) {
    warnIfProd();
    return `${env.APP_URL}/api/v1/files/${encodeURI(key)}`;
  },

  async put(key, body) {
    warnIfProd();
    const path = localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  },

  async get(key) {
    return readFile(localPath(key));
  },

  async remove(key) {
    await unlink(localPath(key)).catch(() => {
      // Already gone is the outcome we wanted.
    });
  },
};

// ─────────────────────────────────────────────── s3

function s3Config() {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    throw new Error(
      "STORAGE_PROVIDER=s3 requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY",
    );
  }
  return {
    endpoint: S3_ENDPOINT,
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    region: env.S3_REGION ?? "auto",
    pathStyle: env.S3_PATH_STYLE ?? true,
  };
}

const s3Storage: Storage = {
  name: "s3",

  async presignUpload(key, contentType, maxBytes) {
    const config = s3Config();
    return presignS3Url({
      ...config,
      method: "PUT",
      key,
      expiresInSeconds: UPLOAD_TTL_SECONDS,
      // Signed in, so the browser cannot upload a different type or a larger
      // file than the server agreed to. Checking afterwards would mean the
      // bytes are already in the bucket.
      query: { "Content-Type": contentType, "Content-Length": String(maxBytes) },
    });
  },

  async presignDownload(key, filename) {
    const config = s3Config();
    return presignS3Url({
      ...config,
      method: "GET",
      key,
      expiresInSeconds: DOWNLOAD_TTL_SECONDS,
      ...(filename
        ? {
            query: {
              "response-content-disposition": `attachment; filename="${filename}"`,
            },
          }
        : {}),
    });
  },

  async put(key, body, contentType) {
    const url = await s3Storage.presignUpload(key, contentType, body.byteLength);
    const response = await fetch(url, {
      method: "PUT",
      body: new Uint8Array(body),
      headers: { "Content-Type": contentType },
    });
    if (!response.ok) {
      throw new Error(`Storage rejected the upload (${response.status})`);
    }
  },

  async get(key) {
    const response = await fetch(await s3Storage.presignDownload(key));
    if (!response.ok) throw new Error(`Storage returned ${response.status} for ${key}`);
    return Buffer.from(await response.arrayBuffer());
  },

  async remove(key) {
    // The same construction with a different verb — the method is part of what
    // gets signed, so this stays one code path rather than a special case.
    const url = presignS3Url({ ...s3Config(), method: "DELETE", key, expiresInSeconds: 60 });

    const response = await fetch(url, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Storage refused to delete ${key} (${response.status})`);
    }
  },
};

// ─────────────────────────────────────────────── selection

function selectStorage(): Storage {
  return env.STORAGE_PROVIDER === "s3" ? s3Storage : localStorage;
}

export const storage: Storage = selectStorage();

export { UPLOAD_TTL_SECONDS, DOWNLOAD_TTL_SECONDS };

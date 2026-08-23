import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4, query-string flavour — presigned URLs.
 *
 * Hand-rolled rather than pulled in with the AWS SDK, which is ten megabytes
 * of client for one signature. The algorithm is small and completely
 * specified, and the tests check it against Amazon's own published example
 * vector — so this is verifiable without a bucket, which the SDK would not
 * have been either.
 *
 * Works against anything speaking S3: AWS, MinIO, Cloudflare R2, Backblaze.
 */

export interface PresignInput {
  method: "GET" | "PUT" | "DELETE";
  /** Endpoint origin, e.g. `https://s3.eu-west-1.amazonaws.com`. */
  endpoint: string;
  bucket: string;
  /** Object key, unencoded. */
  key: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresInSeconds: number;
  /** Extra signed query parameters — content type and length conditions. */
  query?: Record<string, string>;
  /** Overridable so the tests can pin a moment. */
  now?: Date;
  /** Path-style addressing, which MinIO needs and AWS still accepts. */
  pathStyle?: boolean;
}

const ALGORITHM = "AWS4-HMAC-SHA256";
/** A payload nobody hashed: the presigned-URL convention. */
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

/**
 * RFC 3986, which is stricter than `encodeURIComponent`: `!`, `'`, `(`, `)`
 * and `*` are unreserved to JavaScript and reserved to AWS. Getting this
 * wrong produces a signature mismatch on exactly the keys containing those
 * characters, which is the hardest kind of bug to notice.
 */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = "";
  for (const char of value) {
    if (/[A-Za-z0-9\-._~]/.test(char)) {
      out += char;
    } else if (char === "/") {
      out += encodeSlash ? "%2F" : "/";
    } else {
      for (const byte of Buffer.from(char, "utf8")) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      }
    }
  }
  return out;
}

function timestamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const date = hmac(`AWS4${secret}`, dateStamp);
  const regional = hmac(date, region);
  const service = hmac(regional, "s3");
  return hmac(service, "aws4_request");
}

/** The canonical query string: sorted by key, both halves encoded. */
function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${uriEncode(key)}=${uriEncode(params[key]!)}`)
    .join("&");
}

export function presignS3Url(input: PresignInput): string {
  const now = input.now ?? new Date();
  const { amzDate, dateStamp } = timestamps(now);

  const origin = new URL(input.endpoint);
  const pathStyle = input.pathStyle ?? true;

  const host = pathStyle ? origin.host : `${input.bucket}.${origin.host}`;
  const canonicalPath = pathStyle
    ? `/${uriEncode(input.bucket, false)}/${uriEncode(input.key, false)}`
    : `/${uriEncode(input.key, false)}`;

  const credential = `${input.accessKeyId}/${dateStamp}/${input.region}/s3/aws4_request`;

  const params: Record<string, string> = {
    ...input.query,
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  };

  const canonicalRequest = [
    input.method,
    canonicalPath,
    canonicalQuery(params),
    `host:${host}\n`,
    "host",
    UNSIGNED_PAYLOAD,
  ].join("\n");

  const stringToSign = [
    ALGORITHM,
    amzDate,
    `${dateStamp}/${input.region}/s3/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = hmac(
    signingKey(input.secretAccessKey, dateStamp, input.region),
    stringToSign,
  ).toString("hex");

  return `${origin.protocol}//${host}${canonicalPath}?${canonicalQuery(params)}&X-Amz-Signature=${signature}`;
}

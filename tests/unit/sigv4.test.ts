import { describe, expect, it } from "vitest";

import { presignS3Url, uriEncode } from "@/lib/storage/sigv4";

/**
 * Signature Version 4, checked against Amazon's own published example.
 *
 * That vector is what makes a hand-rolled signer defensible: the alternative
 * was ten megabytes of AWS SDK for one signature, and it would have been no
 * more testable here — a wrong signature only shows up as a 403 from a bucket
 * nobody has in CI.
 */

const AWS_EXAMPLE = {
  method: "GET" as const,
  endpoint: "https://s3.amazonaws.com",
  bucket: "examplebucket",
  key: "test.txt",
  region: "us-east-1",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  expiresInSeconds: 86400,
  now: new Date("2013-05-24T00:00:00.000Z"),
  pathStyle: false,
};

function signatureOf(url: string): string {
  return new URL(url).searchParams.get("X-Amz-Signature") ?? "";
}

describe("the documented example", () => {
  it("produces Amazon's signature", () => {
    expect(signatureOf(presignS3Url(AWS_EXAMPLE))).toBe(
      "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("produces Amazon's URL", () => {
    expect(presignS3Url(AWS_EXAMPLE)).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt" +
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20130524T000000Z" +
        "&X-Amz-Expires=86400" +
        "&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });
});

describe("the signature covers everything it should", () => {
  const base = signatureOf(presignS3Url(AWS_EXAMPLE));

  it("changes with the method", () => {
    expect(signatureOf(presignS3Url({ ...AWS_EXAMPLE, method: "PUT" }))).not.toBe(base);
  });

  it("changes with the key", () => {
    expect(signatureOf(presignS3Url({ ...AWS_EXAMPLE, key: "other.txt" }))).not.toBe(base);
  });

  it("changes with the expiry", () => {
    expect(signatureOf(presignS3Url({ ...AWS_EXAMPLE, expiresInSeconds: 600 }))).not.toBe(base);
  });

  it("changes with the secret", () => {
    expect(signatureOf(presignS3Url({ ...AWS_EXAMPLE, secretAccessKey: "other" }))).not.toBe(base);
  });

  it("changes with the extra conditions", () => {
    const withType = presignS3Url({
      ...AWS_EXAMPLE,
      query: { "response-content-type": "image/png" },
    });
    expect(signatureOf(withType)).not.toBe(base);
    // And the condition itself travels in the URL, not just in the signature.
    expect(withType).toContain("response-content-type=image%2Fpng");
  });

  it("is the same twice for the same moment", () => {
    expect(signatureOf(presignS3Url(AWS_EXAMPLE))).toBe(base);
  });
});

describe("path-style addressing", () => {
  it("puts the bucket in the path, for MinIO and the like", () => {
    const url = presignS3Url({ ...AWS_EXAMPLE, pathStyle: true });
    expect(url.startsWith("https://s3.amazonaws.com/examplebucket/test.txt?")).toBe(true);
  });
});

describe("encoding", () => {
  it("escapes what AWS reserves and JavaScript does not", () => {
    // encodeURIComponent leaves all of these alone; AWS does not.
    expect(uriEncode("a!b'c(d)e*f")).toBe("a%21b%27c%28d%29e%2Af");
  });

  it("leaves the unreserved set alone", () => {
    expect(uriEncode("Aa0-._~")).toBe("Aa0-._~");
  });

  it("encodes slashes in a query value but not in a path", () => {
    expect(uriEncode("a/b")).toBe("a%2Fb");
    expect(uriEncode("a/b", false)).toBe("a/b");
  });

  it("encodes non-ASCII per byte", () => {
    expect(uriEncode("é")).toBe("%C3%A9");
  });
});

import { describe, expect, it } from "vitest";

import {
  UPLOAD_POLICY,
  buildKey,
  bytesMatchType,
  checkUpload,
  displayFilename,
  isUploadCategory,
  sniffContentType,
} from "@/lib/storage/policy";

/**
 * Upload rules (docs/09-security.md §5). Every assertion here is something
 * somebody will try: a traversal in the filename, an executable wearing a PDF
 * extension, a file just over the cap.
 */

describe("object keys", () => {
  it("are built entirely by the server", () => {
    const key = buildKey("employee-photo", "company-1", "employee-9", "image/png");
    expect(key).toMatch(/^company-1\/employees\/employee-9\/[0-9a-f-]{36}\.png$/);
  });

  it("cannot be steered by anything the caller sent", () => {
    // The only caller-supplied value that reaches a key is the content type,
    // and it is looked up rather than interpolated.
    const key = buildKey("leave-attachment", "c", "e", "../../etc/passwd");
    expect(key).toBe(key.replace(/\.\./g, ""));
    expect(key.endsWith(".bin")).toBe(true);
  });

  it("leads with the company, so a bucket policy can be written per tenant", () => {
    expect(buildKey("company-logo", "acme", "acme", "image/jpeg").startsWith("acme/")).toBe(true);
  });
});

describe("display filenames", () => {
  it("keep something the person will recognise", () => {
    expect(displayFilename("Sick note March.pdf")).toBe("Sick note March.pdf");
  });

  it("drop any path in front of them", () => {
    expect(displayFilename("../../../etc/passwd")).toBe("passwd");
    expect(displayFilename(String.raw`C:\Windows\System32\config`)).toBe("config");
  });

  it("never come back empty or leading with a dot", () => {
    expect(displayFilename("")).toBe("file");
    expect(displayFilename("...")).toBe("file");
    expect(displayFilename('\n\r"')).toBe("file");
  });
});

describe("what may be uploaded", () => {
  it("accepts a photo inside the cap", () => {
    const result = checkUpload({
      category: "employee-photo",
      contentType: "image/png",
      sizeBytes: 1024,
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a type the category does not take", () => {
    const result = checkUpload({
      category: "employee-photo",
      contentType: "application/pdf",
      sizeBytes: 1024,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses SVG everywhere — it is a document that can carry script", () => {
    for (const category of ["employee-photo", "company-logo", "leave-attachment"] as const) {
      expect(UPLOAD_POLICY[category].mimeTypes).not.toContain("image/svg+xml");
    }
  });

  it("refuses a file over the cap, and an empty one", () => {
    const tooBig = checkUpload({
      category: "company-logo",
      contentType: "image/png",
      sizeBytes: UPLOAD_POLICY["company-logo"].maxBytes + 1,
    });
    expect(tooBig.ok).toBe(false);

    const empty = checkUpload({
      category: "company-logo",
      contentType: "image/png",
      sizeBytes: 0,
    });
    expect(empty.ok).toBe(false);
  });

  it("knows its own categories", () => {
    expect(isUploadCategory("employee-photo")).toBe(true);
    expect(isUploadCategory("payroll-export")).toBe(false);
  });
});

describe("what the bytes say", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  const executable = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);

  it("recognises what it accepts", () => {
    expect(sniffContentType(jpeg)).toBe("image/jpeg");
    expect(sniffContentType(png)).toBe("image/png");
    expect(sniffContentType(pdf)).toBe("application/pdf");
    expect(sniffContentType(webp)).toBe("image/webp");
  });

  it("recognises nothing else", () => {
    expect(sniffContentType(executable)).toBeNull();
    expect(sniffContentType(new Uint8Array([]))).toBeNull();
  });

  it("catches an executable claiming to be a PDF", () => {
    expect(bytesMatchType(executable, "application/pdf")).toBe(false);
    expect(bytesMatchType(pdf, "application/pdf")).toBe(true);
  });

  it("catches a real file claiming to be a different real type", () => {
    expect(bytesMatchType(png, "image/jpeg")).toBe(false);
  });
});

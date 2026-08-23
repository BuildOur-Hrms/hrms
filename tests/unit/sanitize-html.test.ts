import { describe, expect, it } from "vitest";

import { sanitizeHtml } from "@/modules/notifications/service";

/**
 * Announcements are HR-authored and shown to the whole company, so a single
 * escaped tag here is stored XSS for every employee. "Trusted author" is not a
 * security model: a compromised HR account is exactly the case this defends
 * against.
 */

describe("what survives", () => {
  it("keeps ordinary formatting", () => {
    expect(sanitizeHtml("<p>Hello <strong>everyone</strong></p>")).toBe(
      "<p>Hello <strong>everyone</strong></p>",
    );
  });

  it("keeps lists and headings", () => {
    expect(sanitizeHtml("<h2>Notice</h2><ul><li>One</li></ul>")).toBe(
      "<h2>Notice</h2><ul><li>One</li></ul>",
    );
  });

  it("keeps plain text untouched", () => {
    expect(sanitizeHtml("Just a sentence.")).toBe("Just a sentence.");
  });
});

describe("what does not", () => {
  it("removes a script tag and its contents", () => {
    const out = sanitizeHtml("<p>Hi</p><script>steal(document.cookie)</script>");
    expect(out).toBe("<p>Hi</p>");
    expect(out).not.toContain("steal");
  });

  it("removes style, iframe and object wholesale", () => {
    for (const tag of ["style", "iframe", "object", "embed", "form", "svg"]) {
      const out = sanitizeHtml(`<${tag}>payload</${tag}>ok`);
      expect(out).toBe("ok");
    }
  });

  it("strips an unknown tag but keeps its text", () => {
    // An allowlist means a tag nobody thought of is safe by default.
    expect(sanitizeHtml("<marquee>Attention</marquee>")).toBe("Attention");
    expect(sanitizeHtml("<custom-element>text</custom-element>")).toBe("text");
  });

  it("drops every attribute, which takes event handlers with it", () => {
    expect(sanitizeHtml('<p onclick="alert(1)">Hi</p>')).toBe("<p>Hi</p>");
    expect(sanitizeHtml('<strong onmouseover="alert(1)">Hi</strong>')).toBe(
      "<strong>Hi</strong>",
    );
  });

  it("keeps an image out entirely, onerror included", () => {
    expect(sanitizeHtml('<img src=x onerror="alert(1)">')).toBe("");
  });
});

describe("links", () => {
  it("keeps an http link and hardens the target", () => {
    const out = sanitizeHtml('<a href="https://example.com">docs</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("keeps a relative link", () => {
    expect(sanitizeHtml('<a href="/me/leave">leave</a>')).toContain('href="/me/leave"');
  });

  it("keeps mailto", () => {
    expect(sanitizeHtml('<a href="mailto:hr@example.com">mail</a>')).toContain("mailto:");
  });

  it("strips a javascript: URL but keeps the text", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain("javascript:");
    expect(out).toContain("click");
  });

  it("strips a data: URL", () => {
    const out = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(out).not.toContain("data:");
  });

  it("cannot break out of the href attribute", () => {
    const out = sanitizeHtml('<a href="https://x.com&quot; onclick=&quot;alert(1)">x</a>');
    expect(out).not.toContain("onclick");
  });
});

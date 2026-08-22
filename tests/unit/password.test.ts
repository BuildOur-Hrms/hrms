import { describe, expect, it } from "vitest";

import {
  PASSWORD_MIN_LENGTH,
  checkPasswordPolicy,
  hashPassword,
  verifyPassword,
} from "@/modules/auth/password";
import { hashToken, issueToken, tokenMatches } from "@/modules/auth/tokens";

describe("password policy", () => {
  it("requires the configured minimum length", () => {
    expect(checkPasswordPolicy("short").ok).toBe(false);
    expect(checkPasswordPolicy("a".repeat(PASSWORD_MIN_LENGTH - 1)).ok).toBe(false);
    expect(checkPasswordPolicy("correct horse battery staple").ok).toBe(true);
  });

  it("honours a company override of the minimum", () => {
    expect(checkPasswordPolicy("abcdefghijkl", 16).ok).toBe(false);
    expect(checkPasswordPolicy("abcdefghijklmnop", 16).ok).toBe(true);
  });

  it("rejects known breached passwords regardless of length", () => {
    const result = checkPasswordPolicy("password123");
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/breach/i);
  });

  it("is case-insensitive about breached passwords", () => {
    expect(checkPasswordPolicy("Password123").ok).toBe(false);
  });

  it("rejects a single repeated character", () => {
    expect(checkPasswordPolicy("aaaaaaaaaaaa").ok).toBe(false);
  });

  it("imposes no character-class rules", () => {
    // A long passphrase with no digits or symbols is fine, by design.
    expect(checkPasswordPolicy("the quick brown fox jumps").ok).toBe(true);
  });
});

describe("password hashing", () => {
  it("round-trips a password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery stapl")).toBe(false);
  });

  it("produces a different hash each time", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same password"),
      hashPassword("same password"),
    ]);
    expect(a).not.toBe(b);
  });

  it("fails closed on a malformed hash instead of throwing", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
    expect(await verifyPassword("", "anything")).toBe(false);
  });
});

describe("invite and reset tokens", () => {
  it("never stores the raw token", () => {
    const token = issueToken("reset");
    expect(token.hash).not.toBe(token.raw);
    expect(token.hash).toHaveLength(64);
    expect(token.hash).toBe(hashToken(token.raw));
  });

  it("gives an invite a longer life than a reset", () => {
    const invite = issueToken("invite");
    const reset = issueToken("reset");
    expect(invite.expiresAt.getTime()).toBeGreaterThan(reset.expiresAt.getTime());
  });

  it("matches only the token it was issued for", () => {
    const token = issueToken("invite");
    expect(tokenMatches(token.raw, token.hash)).toBe(true);
    expect(tokenMatches(`${token.raw}x`, token.hash)).toBe(false);
    expect(tokenMatches("", token.hash)).toBe(false);
  });

  it("produces unguessable tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => issueToken("reset").raw));
    expect(tokens.size).toBe(50);
    for (const raw of tokens) expect(raw.length).toBeGreaterThanOrEqual(42);
  });
});

/**
 * Password policy (docs/09-security.md §2).
 *
 * Deliberately isomorphic: the login and reset forms import it through the
 * shared zod schemas, so it must not pull in anything Node-only. Hashing lives
 * next door in `password.ts`, which does depend on a native argon2 binding and
 * therefore never reaches the browser.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * The most-reused passwords, which dominate real credential-stuffing lists.
 * The full top-100k list is a Phase 2 data file and an HIBP k-anonymity check
 * is Phase 3; this covers the passwords people actually type first.
 */
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "passw0rd123",
  "123456789",
  "1234567890",
  "12345678910",
  "qwertyuiop",
  "qwerty12345",
  "1q2w3e4r5t",
  "iloveyou123",
  "admin12345",
  "administrator",
  "letmein123",
  "welcome123",
  "welcome1234",
  "abc12345678",
  "monkey12345",
  "football123",
  "baseball123",
  "sunshine123",
  "princess123",
  "dragon12345",
  "trustno1234",
  "changeme123",
  "companyname",
  "hrms1234567",
  "temppassword",
  "newpassword",
  "secret12345",
]);

export interface PasswordPolicyResult {
  ok: boolean;
  problems: string[];
}

/**
 * Length plus a breach check, and deliberately no character-class rules:
 * complexity requirements push people toward `Password1!`, which is worse than
 * a long passphrase.
 */
export function checkPasswordPolicy(
  password: string,
  minLength = PASSWORD_MIN_LENGTH,
): PasswordPolicyResult {
  const problems: string[] = [];

  if (password.length < minLength) {
    problems.push(`Must be at least ${minLength} characters`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`Must be at most ${PASSWORD_MAX_LENGTH} characters`);
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    problems.push("This password appears in known breach lists — choose another");
  }
  if (/^(.)\1+$/.test(password)) {
    problems.push("Cannot be a single repeated character");
  }

  return { ok: problems.length === 0, problems };
}

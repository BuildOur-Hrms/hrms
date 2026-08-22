import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing (docs/09-security.md §2). Server-only: `@node-rs/argon2` is
 * a native binding. The policy rules the forms also need live in `policy.ts`,
 * which is safe to import from the browser.
 *
 * argon2id with a ~100 ms server budget: memory-hard, so a leaked hash dump is
 * expensive to attack with GPUs, while a legitimate login pays it once.
 */

/**
 * `Algorithm.Argon2id`. The upstream enum is an ambient `const enum`, which
 * cannot be referenced under `isolatedModules`, so the value is inlined.
 */
const ARGON2ID = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  /** 64 MiB per hash. */
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS);
}

export async function verifyPassword(hashed: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(hashed, plaintext, ARGON2_OPTIONS);
  } catch {
    // A malformed or truncated hash must fail closed, never throw a 500 that
    // tells an attacker their guess was interesting.
    return false;
  }
}

/**
 * A hash of a throwaway value, used to burn the same CPU time when the email
 * does not exist. Without it, "no such user" returns in 1 ms and "wrong
 * password" in 100 ms, which is a free user-enumeration oracle.
 */
let dummyHashPromise: Promise<string> | null = null;

export function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("this-account-does-not-exist");
  return dummyHashPromise;
}

export {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  checkPasswordPolicy,
  type PasswordPolicyResult,
} from "./policy";

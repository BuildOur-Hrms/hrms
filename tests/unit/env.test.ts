import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Environment resolution.
 *
 * These exist because of two real deployment failures:
 *
 *  - A variable declared in a hosting dashboard but left blank arrives as `""`,
 *    not as absent, so schema defaults never applied and the deploy failed on
 *    variables the operator had never meaningfully set.
 *  - `next build` imports every route module, which meant compiling required
 *    the production database credentials.
 *
 * `src/lib/env.ts` validates at module load, so each case re-imports it with
 * `vi.resetModules()`.
 */

const VARS = [
  "NODE_ENV",
  "NEXT_PHASE",
  "APP_URL",
  "LOG_LEVEL",
  "DATABASE_URL",
  "AUTH_SECRET",
  "EMAIL_PROVIDER",
  "QUEUE_DRIVER",
  "SEED_ADMIN_EMAIL",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
];

const VALID_SECRET = "a".repeat(40);
const VALID_DB = "postgresql://user:pass@localhost:5432/db";

async function loadEnv(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of VARS) vi.stubEnv(key, undefined);
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
  return import("@/lib/env");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("blank values", () => {
  it("treats an empty string as unset so the default applies", async () => {
    const { env } = await loadEnv({
      DATABASE_URL: VALID_DB,
      AUTH_SECRET: VALID_SECRET,
      LOG_LEVEL: "",
      EMAIL_PROVIDER: "",
      SEED_ADMIN_EMAIL: "",
    });

    expect(env.LOG_LEVEL).toBe("info");
    expect(env.EMAIL_PROVIDER).toBe("console");
    expect(env.SEED_ADMIN_EMAIL).toBe("admin@example.com");
  });

  it("treats whitespace as unset too", async () => {
    const { env } = await loadEnv({
      DATABASE_URL: VALID_DB,
      AUTH_SECRET: VALID_SECRET,
      LOG_LEVEL: "   ",
    });
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("still rejects a value that is present and wrong", async () => {
    await expect(
      loadEnv({
        DATABASE_URL: VALID_DB,
        AUTH_SECRET: VALID_SECRET,
        EMAIL_PROVIDER: "carrier-pigeon",
      }),
    ).rejects.toThrow(/EMAIL_PROVIDER/);
  });
});

describe("required configuration", () => {
  it("refuses to start without a database url", async () => {
    await expect(loadEnv({ AUTH_SECRET: VALID_SECRET })).rejects.toThrow(/DATABASE_URL/);
  });

  it("refuses a short auth secret", async () => {
    await expect(loadEnv({ DATABASE_URL: VALID_DB, AUTH_SECRET: "too-short" })).rejects.toThrow(
      /AUTH_SECRET/,
    );
  });
});

describe("build phase", () => {
  it("compiles without runtime secrets", async () => {
    const { env } = await loadEnv({ NEXT_PHASE: "phase-production-build" });
    // Placeholders, so module initialisation succeeds. Nothing connects.
    expect(env.DATABASE_URL).toContain("placeholder");
    expect(env.AUTH_SECRET).toContain("placeholder");
  });

  it("does not mask a value that is malformed rather than missing", async () => {
    await expect(
      loadEnv({ NEXT_PHASE: "phase-production-build", EMAIL_PROVIDER: "carrier-pigeon" }),
    ).rejects.toThrow(/EMAIL_PROVIDER/);
  });

  it("prefers a real value over the placeholder", async () => {
    const { env } = await loadEnv({
      NEXT_PHASE: "phase-production-build",
      DATABASE_URL: VALID_DB,
    });
    expect(env.DATABASE_URL).toBe(VALID_DB);
  });
});

describe("APP_URL on Vercel", () => {
  it("uses the stable domain in production", async () => {
    const { env } = await loadEnv({
      DATABASE_URL: VALID_DB,
      AUTH_SECRET: VALID_SECRET,
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "hrms.example.com",
      VERCEL_URL: "hrms-abc123.vercel.app",
    });
    expect(env.APP_URL).toBe("https://hrms.example.com");
  });

  it("uses the deployment domain on a preview, so invite links stay on it", async () => {
    const { env } = await loadEnv({
      DATABASE_URL: VALID_DB,
      AUTH_SECRET: VALID_SECRET,
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_PRODUCTION_URL: "hrms.example.com",
      VERCEL_URL: "hrms-abc123.vercel.app",
    });
    expect(env.APP_URL).toBe("https://hrms-abc123.vercel.app");
  });

  it("lets an explicit APP_URL win", async () => {
    const { env } = await loadEnv({
      DATABASE_URL: VALID_DB,
      AUTH_SECRET: VALID_SECRET,
      APP_URL: "https://hr.acme.com",
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "hrms.example.com",
    });
    expect(env.APP_URL).toBe("https://hr.acme.com");
  });

  it("falls back to localhost off-platform", async () => {
    const { env, isServerless } = await loadEnv({
      DATABASE_URL: VALID_DB,
      AUTH_SECRET: VALID_SECRET,
    });
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(isServerless).toBe(false);
  });
});

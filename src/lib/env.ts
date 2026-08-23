import { z } from "zod";

/**
 * Server environment. Parsed once at module load so a misconfigured deploy
 * fails at boot rather than at the first request that needs the variable.
 *
 * Catalog: docs/10-roadmap-testing-deployment.md §4.
 * Never import this from a client component.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_DATABASE_URL: z.string().optional(),

  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),

  REDIS_URL: z.string().optional(),
  /**
   * `auto`   — BullMQ when REDIS_URL is set, otherwise inline in development
   *            and a hard failure in production.
   * `inline` — run jobs in-process even in production. Required on a
   *            serverless host with no worker, and an explicit acknowledgement
   *            that jobs get no retries.
   */
  QUEUE_DRIVER: z.enum(["auto", "inline"]).default("auto"),

  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  EMAIL_PROVIDER: z.enum(["console", "smtp", "resend"]).default("console"),
  EMAIL_FROM: z.string().default("HRMS <no-reply@example.com>"),
  SMTP_URL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),

  /**
   * Shared secret for the scheduled-job endpoints. Vercel Cron sends it as
   * `Authorization: Bearer <secret>`. Without it those routes refuse every
   * request rather than defaulting to open — an unauthenticated endpoint that
   * rebuilds attendance for the whole company is not a thing to fail open.
   */
  CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 characters").optional(),

  FIELD_ENCRYPTION_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),

  SEED_COMPANY_NAME: z.string().default("Acme Corp"),
  SEED_COMPANY_SLUG: z.string().default("acme"),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@example.com"),
  SEED_HR_EMAIL: z.string().email().default("hr@example.com"),
  SEED_DEMO: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

/**
 * Vercel does not know the deployment's own URL until it exists, so APP_URL is
 * derived when it has not been set explicitly. It matters for two things: the
 * absolute links in invite and reset emails, and the Origin check on mutating
 * requests.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` is the stable production domain;
 * `VERCEL_URL` is the per-deployment one, which is what a preview should use.
 */
function resolveAppUrl(): string | undefined {
  if (process.env["APP_URL"]) return process.env["APP_URL"];

  const host =
    process.env["VERCEL_ENV"] === "production"
      ? process.env["VERCEL_PROJECT_PRODUCTION_URL"]
      : (process.env["VERCEL_URL"] ?? process.env["VERCEL_PROJECT_PRODUCTION_URL"]);

  return host ? `https://${host}` : undefined;
}

/**
 * `next build` imports every route module to collect its metadata. None of
 * that opens a database connection or sends mail, so a missing runtime secret
 * must not fail the build — otherwise every preview deployment and every fork
 * needs the production credentials just to compile. The strict check below
 * still runs on the first real request, which is where it belongs.
 */
const isBuildPhase = process.env["NEXT_PHASE"] === "phase-production-build";

/** Stand-ins for the two secrets with no default, used only during the build. */
const BUILD_PLACEHOLDERS = {
  DATABASE_URL: "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder",
  AUTH_SECRET: "build-phase-placeholder-value-not-a-real-secret",
} as const;

/**
 * A variable declared in a dashboard but left blank arrives as `""`, which is
 * not the same as unset: zod runs it through the enum and email checks and
 * rejects it instead of falling back to the default. Nobody means "empty
 * string" when they leave a field blank, so treat it as absent.
 */
function withoutBlanks(source: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && value.trim() !== "") out[key] = value;
  }
  return out;
}

function describe(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
}

function load() {
  const source = withoutBlanks({ ...process.env, APP_URL: resolveAppUrl() });

  const parsed = schema.safeParse(source);
  if (parsed.success) return parsed.data;

  if (isBuildPhase) {
    const withPlaceholders = schema.safeParse({ ...BUILD_PLACEHOLDERS, ...source });
    if (withPlaceholders.success) {
      // Kept to one line: the build evaluates this once per worker process.
      const missing = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
      console.warn(
        `[env] building without: ${missing} — not needed to compile, but the ` +
          `deployment will fail on its first request unless they are set.`,
      );
      return withPlaceholders.data;
    }
    // Something is genuinely malformed rather than merely absent — for example
    // EMAIL_PROVIDER set to a value that is not in the enum. Fail the build.
    throw new Error(
      `Invalid environment configuration:\n${describe(withPlaceholders.error.issues)}`,
    );
  }

  throw new Error(`Invalid environment configuration:\n${describe(parsed.error.issues)}`);
}

export const env = load();

export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

/**
 * Running on a serverless platform: no long-lived process, so connection pools
 * must stay small and background work cannot outlive the response.
 */
export const isServerless = !!process.env["VERCEL"];

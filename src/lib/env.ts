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

  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  EMAIL_PROVIDER: z.enum(["console", "smtp", "resend"]).default("console"),
  EMAIL_FROM: z.string().default("HRMS <no-reply@example.com>"),
  SMTP_URL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),

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

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = load();

export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

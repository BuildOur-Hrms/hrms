import pino from "pino";

import { env, isProd } from "./env";

/**
 * Structured JSON logs. Every request carries a `requestId` that is propagated
 * into any job it enqueues, so a worker failure is traceable back to the click
 * that caused it.
 *
 * Never log tokens, password hashes, or request bodies containing PII.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "hrms" },
  redact: {
    paths: [
      "password",
      "passwordHash",
      "password_hash",
      "token",
      "tokenHash",
      "authorization",
      "cookie",
      "*.password",
      "*.token",
      "req.headers.cookie",
      "req.headers.authorization",
    ],
    censor: "[redacted]",
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname,service" },
        },
      }),
});

export type RequestLogger = pino.Logger;

export function childLogger(bindings: Record<string, unknown>): RequestLogger {
  return logger.child(bindings);
}

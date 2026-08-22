import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Native or Node-only packages that must be `require`d at runtime rather
   * than bundled: native bindings (argon2), transport-spawning loggers (pino),
   * and libraries reaching for `child_process`/`net` (BullMQ, ioredis, pg).
   */
  serverExternalPackages: [
    "@node-rs/argon2",
    "@prisma/adapter-pg",
    "bullmq",
    "ioredis",
    "pg",
    "pino",
    "pino-pretty",
  ],

  /**
   * `@node-rs/argon2` picks its native binary at runtime with a platform
   * switch over `require("@node-rs/argon2-linux-x64-gnu")` and friends. Static
   * tracing does not always follow that, and the failure mode on a serverless
   * host is a 500 on every login rather than a build error. Include the
   * binaries explicitly for the routes that hash or verify a password.
   */
  outputFileTracingIncludes: {
    "/api/v1/auth/**": ["./node_modules/@node-rs/argon2-*/**"],
    "/api/v1/employees/**": ["./node_modules/@node-rs/argon2-*/**"],
    "/api/v1/users/**": ["./node_modules/@node-rs/argon2-*/**"],
  },

  /** Never leak stack traces or framework internals in a response header. */
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Nothing under the API is ever cacheable: every response is
        // permission-scoped to one caller.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;

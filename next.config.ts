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

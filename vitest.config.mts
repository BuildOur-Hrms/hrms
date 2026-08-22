import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Resolves the `@/*` alias from tsconfig.json natively.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Integration and e2e suites need a live database and a browser; they run
    // in their own CI jobs (docs/10-roadmap-testing-deployment.md §3).
    exclude: ["node_modules/**", "tests/e2e/**"],
    setupFiles: ["tests/setup.ts"],
  },
});

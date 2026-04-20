import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      // ── Unit tests (Node/Bun runtime) ─────────────────────
      {
        test: {
          name: "unit",
          globals: true,
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "e2e",
          globals: true,
          include: ["tests/e2e/**/*.test.ts"],
          hookTimeout: 120_000,
          testTimeout: 120_000,
          // E2E tests share a common fixture dir (fixtures/e2e-app) and a
          // wrangler seed SQL path — serialize via fileParallelism=false and
          // the --maxWorkers 1 flag set on test:e2e in package.json.
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "interactive",
          globals: true,
          include: ["tests/interactive/**/*.test.ts"],
          hookTimeout: 30_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Inline projects inherit the root `test` options (vitest 5 `extends: true`).
    globals: true,
    projects: [
      // ── Unit tests (Node/Bun runtime) ─────────────────────
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
        },
      },
      // ── Integration (built binary, no server) ────────────────
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.test.ts"],
          globalSetup: ["./tests/e2e/global-setup.ts"],
          hookTimeout: 120_000,
          testTimeout: 120_000,
        },
      },
      // ── Slow tests (real Android build via gradlew) ──────
      {
        test: {
          name: "slow",
          include: ["tests/slow/**/*.test.ts"],
          globalSetup: ["./tests/e2e/global-setup.ts"],
          hookTimeout: 120_000,
          testTimeout: 900_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "interactive",
          include: ["tests/interactive/**/*.test.ts"],
          hookTimeout: 30_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});

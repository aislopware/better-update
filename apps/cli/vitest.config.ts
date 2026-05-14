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
          globalSetup: ["./tests/e2e/global-setup.ts"],
          hookTimeout: 120_000,
          testTimeout: 120_000,
        },
      },
      // ── Slow tests (real Android build via gradlew) ──────
      {
        test: {
          name: "slow",
          globals: true,
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
          globals: true,
          include: ["tests/interactive/**/*.test.ts"],
          hookTimeout: 30_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});

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

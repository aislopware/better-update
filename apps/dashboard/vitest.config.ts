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
      // ── Component tests (jsdom) ────────────────────────────
      {
        test: {
          name: "component",
          globals: true,
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./tests/setup.ts"],
        },
      },
      // ── E2E tests (full Worker HTTP server) ────────────────
      {
        test: {
          name: "e2e",
          globals: true,
          include: ["tests/e2e/**/*.test.ts"],
          testTimeout: 30_000,
        },
      },
    ],
  },
});

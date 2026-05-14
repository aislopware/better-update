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
      // ── E2E API tests (HTTP only, parallel-safe) ──────────
      {
        test: {
          name: "e2e-api",
          globals: true,
          include: ["tests/e2e/**/*.test.ts"],
          exclude: ["tests/e2e/browser-*.test.ts", "**/node_modules/**"],
          globalSetup: ["tests/e2e/global-setup.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
      // ── E2E browser tests (Playwright, must serialize) ────
      {
        test: {
          name: "e2e-browser",
          globals: true,
          include: ["tests/e2e/browser-*.test.ts"],
          globalSetup: ["tests/e2e/global-setup.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});

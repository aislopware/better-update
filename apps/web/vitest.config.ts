import { defineConfig } from "vitest/config";

import { siteDefines } from "./site-defines";

export default defineConfig({
  // Same build-time site identity `vite.config.ts` bakes in.
  define: siteDefines(),
  test: {
    // Inline projects extend this config (vitest 5's default), so every one of
    // them runs with globals from here.
    globals: true,
    projects: [
      // ── Unit tests (Node/Bun runtime) ─────────────────────
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
        },
      },
      // ── Component tests (jsdom) ────────────────────────────
      {
        test: {
          name: "component",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./tests/setup.ts"],
        },
      },
      // ── E2E API tests (HTTP only, parallel-safe) ──────────
      {
        test: {
          name: "e2e-api",
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

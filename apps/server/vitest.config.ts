import path from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));

  return {
    test: {
      coverage: {
        provider: "istanbul" as const,
        include: ["src/auth/**/*.ts", "src/cloudflare/**/*.ts", "src/domain/**/*.ts"],
        exclude: [
          "src/**/*.test.ts",
          "src/**/*.d.ts",
          "src/auth/middleware.ts",
          // Imperative shell adapters are covered indirectly via repo/handler tests.
          "src/cloudflare/asset-storage.ts",
          "src/cloudflare/build-runtime.ts",
          "src/cloudflare/manifest-runtime.ts",
          "src/cloudflare/signed-url.ts",
          "src/cloudflare/update-coordinator.ts",
          "src/cloudflare/vault.ts",
        ],
        thresholds: {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
      },
      projects: [
        // ── Unit tests (Node/Bun runtime) ─────────────────────
        {
          test: {
            name: "unit",
            globals: true,
            include: ["src/**/*.test.ts"],
          },
        },
        // ── Integration tests (Workers runtime via workerd) ───
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  TEST_MODE: "true",
                  BETTER_AUTH_SECRET: "integration-test-secret-that-is-at-least-32-chars",
                  BETTER_AUTH_URL: "http://localhost",
                  DASHBOARD_URL: "http://localhost",
                  GITHUB_CLIENT_ID: "test-github-id",
                  GITHUB_CLIENT_SECRET: "test-github-secret",
                },
              },
            }),
          ],
          test: {
            name: "integration",
            globals: true,
            include: ["tests/integration/**/*.test.ts"],
            setupFiles: ["./tests/setup-d1.ts"],
          },
        },
        // ── E2E tests (full Worker HTTP server) ───────────────
        {
          test: {
            name: "e2e",
            globals: true,
            include: ["tests/e2e/**/*.test.ts"],
            hookTimeout: 30_000,
            testTimeout: 30_000,
          },
        },
      ],
    },
  };
});

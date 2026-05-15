import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseDotenvContent } from "@better-update/dotenv";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const parseEnvFile = (filePath: string): Record<string, string> =>
  existsSync(filePath)
    ? Object.fromEntries(
        Object.entries(parseDotenvContent(readFileSync(filePath, "utf8"))).filter(
          ([, value]) => value !== "",
        ),
      )
    : {};

/**
 * Wrangler's remote R2 proxy needs `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`
 * in process env. Map them from `.env.local` (which uses `E2E_*` prefix) so
 * `bun run test:integrations` works without the caller exporting them manually.
 */
const hydrateCloudflareProcessEnv = () => {
  const envFile = parseEnvFile(path.join(__dirname, ".env.local"));
  if (!process.env["CLOUDFLARE_ACCOUNT_ID"] && envFile["E2E_CF_ACCOUNT_ID"]) {
    process.env["CLOUDFLARE_ACCOUNT_ID"] = envFile["E2E_CF_ACCOUNT_ID"];
  }
  if (!process.env["CLOUDFLARE_API_TOKEN"] && envFile["E2E_CLOUDFLARE_API_TOKEN"]) {
    process.env["CLOUDFLARE_API_TOKEN"] = envFile["E2E_CLOUDFLARE_API_TOKEN"];
  }
};

export default defineConfig(async () => {
  hydrateCloudflareProcessEnv();
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
          "src/cloudflare/apple-app-store-connect.ts",
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
                  ACCOUNT_ID: "integration-account",
                  BETTER_AUTH_SECRET: "integration-test-secret-that-is-at-least-32-chars",
                  BETTER_AUTH_URL: "http://localhost",
                  CLOUDFLARE_API_TOKEN: "integration-cf-api-token",
                  WEB_URL: "http://localhost",
                  GITHUB_CLIENT_ID: "test-github-id",
                  GITHUB_CLIENT_SECRET: "test-github-secret",
                  INSTALL_TOKEN_SECRET: "integration-install-token-secret-at-least-32-chars",
                  R2_ACCESS_KEY_ID: "integration-r2-access-key",
                  R2_SECRET_ACCESS_KEY: "integration-r2-secret-key",
                  VAULT_KEYRING: '{"1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="}',
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
            globalSetup: ["./tests/e2e/global-setup.ts"],
            hookTimeout: 60_000,
            testTimeout: 30_000,
          },
        },
      ],
    },
  };
});

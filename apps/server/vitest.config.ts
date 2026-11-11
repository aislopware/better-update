import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseDotenvContent } from "@better-update/dotenv";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
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
  // `import.meta.dirname`, not `__dirname`: Vite's native config loader (the
  // planned default) does not define the CJS global.
  const envFile = parseEnvFile(path.join(import.meta.dirname, ".env.local"));
  if (!process.env["CLOUDFLARE_ACCOUNT_ID"] && envFile["E2E_CF_ACCOUNT_ID"]) {
    process.env["CLOUDFLARE_ACCOUNT_ID"] = envFile["E2E_CF_ACCOUNT_ID"];
  }
  if (!process.env["CLOUDFLARE_API_TOKEN"] && envFile["E2E_CLOUDFLARE_API_TOKEN"]) {
    process.env["CLOUDFLARE_API_TOKEN"] = envFile["E2E_CLOUDFLARE_API_TOKEN"];
  }
};

/**
 * The single E2E file that PUTs bytes to a presigned R2 URL
 * (`*.r2.cloudflarestorage.com`) and depends on R2's server-side checksum
 * enforcement — the one contract miniflare cannot simulate. It runs on the
 * dedicated `e2e-pool-r2` project, whose R2 binding is `remote: true` → the real
 * `*-e2e` bucket. Every other e2e flow seeds local R2 directly via
 * `seedAssetObject` (assets) or relies on `complete` not re-heading R2 (builds),
 * so it runs on `e2e-pool` with local D1/R2 (no remote, no Cloudflare auth).
 * Excluded from `e2e-pool` so it isn't run against local R2.
 */
const R2_E2E = ["tests/e2e/direct-upload-flow.test.ts"];

export default defineConfig(async () => {
  hydrateCloudflareProcessEnv();
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

  // Shared Workers-runtime pool options for the integration + pool-backed e2e
  // projects: same local D1 (migrations applied via setup-d1.ts) + miniflare
  // bindings, so both run the real worker against local bindings.
  const workersTestOptions = {
    // `cloudflare.config.ts`, evaluated with `mode: "test"` (the Vite mode).
    experimental: { newConfig: true },
    // Match the vite plugin in vite.config.ts — the Workers vitest plugin also
    // chokes on remote bindings when Durable Object bindings are present
    // (CF API 10375 on edge-preview).
    remoteBindings: false,
    miniflare: {
      bindings: {
        TEST_MIGRATIONS: migrations,
        TEST_MODE: "true",
        // Pinned so a developer's `BU_ORG_CREATION=superadmin` cannot stop
        // ordinary approved test users from creating orgs.
        ORG_CREATION: "approved",
        ACCOUNT_ID: "integration-account",
        BETTER_AUTH_SECRET: "integration-test-secret-that-is-at-least-32-chars",
        BETTER_AUTH_URL: "http://localhost",
        CLOUDFLARE_API_TOKEN: "integration-cf-api-token",
        WEB_URL: "http://localhost",
        GITHUB_CLIENT_ID: "test-github-id",
        GITHUB_CLIENT_SECRET: "test-github-secret",
        GOOGLE_CLIENT_ID: "test-google-id",
        GOOGLE_CLIENT_SECRET: "test-google-secret",
        INSTALL_TOKEN_SECRET: "integration-install-token-secret-at-least-32-chars",
        APT_SIGNING_SECRET: "integration-apt-signing-secret-at-least-32-chars",
        R2_ACCESS_KEY_ID: "integration-r2-access-key",
        R2_SECRET_ACCESS_KEY: "integration-r2-secret-key",
      },
    },
  };

  // Pool options for the R2-upload e2e files: same local D1/KV/DO, but the R2
  // buckets connect to the real `*-e2e` buckets via per-binding
  // `dev: { remote: true }` (cloudflare.config.ts). `remoteBindings: true` is
  // the global gate; DO bindings are excluded from remote proxying so they keep
  // running locally (avoids the 10375 edge-preview error). The config names the
  // `*-e2e` buckets for every mode but `production`, which keeps these off the
  // production buckets.
  // Real Cloudflare creds come from `.env.local` (E2E_*); the remote proxy auth
  // (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN) is hydrated above.
  const envLocal = parseEnvFile(path.join(import.meta.dirname, ".env.local"));
  const realR2TestOptions = {
    experimental: { newConfig: true },
    remoteBindings: true,
    miniflare: {
      bindings: {
        ...workersTestOptions.miniflare.bindings,
        ACCOUNT_ID: envLocal["E2E_CF_ACCOUNT_ID"] ?? "",
        R2_ACCESS_KEY_ID: envLocal["E2E_R2_ACCESS_KEY_ID"] ?? "",
        R2_SECRET_ACCESS_KEY: envLocal["E2E_R2_SECRET_ACCESS_KEY"] ?? "",
        ASSETS_BUCKET_NAME: envLocal["E2E_ASSETS_BUCKET_NAME"] ?? "better-update-assets-e2e",
        BUILD_BUCKET_NAME: envLocal["E2E_BUILD_BUCKET_NAME"] ?? "better-update-builds-e2e",
      },
    },
  };

  // Vitest 5 caches transformed modules on disk by default and hands a reused
  // worker the whole cached import graph in one snapshot. The Workers plugin
  // inlines that snapshot into ONE WebSocket message to workerd (~60 MB for
  // this server), which workerd closes with 1009 "Message is too large" — so
  // every test file after a worker's first died as "Worker exited
  // unexpectedly". Without the disk cache the snapshot carries no module code.
  const workersRuntime = { fsModuleCache: false, setupFiles: ["./tests/setup-d1.ts"] };

  return {
    test: {
      // Inline projects inherit the root `test` options (Vitest 5).
      globals: true,
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
          "src/cloudflare/credential-artifacts.ts",
          "src/cloudflare/email-service.ts",
          "src/cloudflare/manifest-cache-storage.ts",
          "src/cloudflare/manifest-runtime.ts",
          "src/cloudflare/signed-url.ts",
          "src/cloudflare/update-coordinator.ts",
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
            include: ["src/**/*.test.ts"],
          },
        },
        // ── Integration tests (Workers runtime via workerd) ───
        {
          plugins: [cloudflareTest(workersTestOptions)],
          test: {
            name: "integration",
            include: ["tests/integration/**/*.test.ts"],
            ...workersRuntime,
            // Seeding hooks here drive real D1 one statement at a time — the OTA
            // reaper's parameter-ceiling suite writes ~725 rows before its first
            // assertion — so the 10s default is a CI-speed lottery, not a
            // meaningful bound.
            hookTimeout: 60_000,
          },
        },
        // ── Pool-backed E2E (Workers runtime, worker.fetch in-process) ──
        // Pure-API flows run here: no wrangler, no Cloudflare auth, local D1/R2.
        {
          plugins: [cloudflareTest(workersTestOptions)],
          test: {
            name: "e2e-pool",
            include: ["tests/e2e/**/*.test.ts"],
            exclude: R2_E2E,
            ...workersRuntime,
          },
        },
        // ── R2-upload E2E (pool runtime + REAL R2 via remote binding) ──
        // The lone direct-upload file: presigned PUT hits the real `*-e2e` bucket
        // so R2's checksum enforcement is exercised; D1/KV/DO stay local. Fast
        // startup (no unstable_startWorker), needs E2E_* Cloudflare creds in
        // .env.local. Run via `bun run test:e2e-r2`.
        {
          plugins: [cloudflareTest(realR2TestOptions)],
          test: {
            name: "e2e-pool-r2",
            include: R2_E2E,
            ...workersRuntime,
          },
        },
      ],
    },
  };
});

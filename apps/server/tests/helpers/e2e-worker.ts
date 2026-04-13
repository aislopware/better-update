import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { unstable_startWorker } from "wrangler";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const envLocalPath = resolve(PROJECT_ROOT, ".env.local");

const envLocal = `BETTER_AUTH_SECRET=e2e-test-secret-that-is-at-least-32-chars
TEST_MODE=true
GITHUB_CLIENT_ID=e2e-github-id
GITHUB_CLIENT_SECRET=e2e-github-secret
R2_ACCESS_KEY_ID=e2e-r2-access-key
R2_SECRET_ACCESS_KEY=e2e-r2-secret-key
INSTALL_TOKEN_SECRET=e2e-install-token-secret-at-least-32-chars
ASSET_CDN_URL=https://assets.better-update.dev
`;

export function setupE2EWorker(persistDir: string): { getBaseUrl: () => string } {
  let worker: Awaited<ReturnType<typeof unstable_startWorker>>;
  let baseUrl: string;
  const persistPath = resolve(PROJECT_ROOT, persistDir);

  beforeAll(async () => {
    rmSync(persistPath, { recursive: true, force: true });
    writeFileSync(envLocalPath, envLocal);

    execSync(`bunx wrangler d1 migrations apply DB --local --persist-to ${persistDir}`, {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
    });

    const originalCwd = process.cwd();

    process.chdir(PROJECT_ROOT);
    try {
      worker = await unstable_startWorker({
        config: resolve(PROJECT_ROOT, "wrangler.jsonc"),
        build: { nodejsCompatMode: "v2" },
        dev: {
          server: { port: 0 },
          inspector: false,
          logLevel: "error",
          persist: persistPath,
        },
      });
    } finally {
      process.chdir(originalCwd);
    }

    const url = await worker.url;
    baseUrl = url.href.replace(/\/$/, "");
  });

  afterAll(async () => {
    await worker?.dispose();
    rmSync(persistPath, { recursive: true, force: true });
    rmSync(envLocalPath, { force: true });
  });

  return { getBaseUrl: () => baseUrl };
}

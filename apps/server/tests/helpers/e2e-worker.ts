import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";

import { unstable_startWorker } from "wrangler";

const envLocalPath = ".env.local";

const envLocal = `BETTER_AUTH_SECRET=e2e-test-secret-that-is-at-least-32-chars
GITHUB_CLIENT_ID=e2e-github-id
GITHUB_CLIENT_SECRET=e2e-github-secret
R2_ACCESS_KEY_ID=e2e-r2-access-key
R2_SECRET_ACCESS_KEY=e2e-r2-secret-key
INSTALL_TOKEN_SECRET=e2e-install-token-secret-at-least-32-chars
`;

export function setupE2EWorker(persistDir: string): { getBaseUrl: () => string } {
  let worker: Awaited<ReturnType<typeof unstable_startWorker>>;
  let baseUrl: string;

  beforeAll(async () => {
    rmSync(persistDir, { recursive: true, force: true });
    writeFileSync(envLocalPath, envLocal);

    execSync(`bunx wrangler d1 migrations apply DB --local --persist-to ${persistDir}`, {
      stdio: "pipe",
    });

    worker = await unstable_startWorker({
      config: "wrangler.jsonc",
      dev: {
        server: { port: 0 },
        inspector: false,
        persist: persistDir,
      },
    });
    const url = await worker.url;
    baseUrl = url.href.replace(/\/$/, "");
  });

  afterAll(async () => {
    await worker?.dispose();
    rmSync(persistDir, { recursive: true, force: true });
    rmSync(envLocalPath, { force: true });
  });

  return { getBaseUrl: () => baseUrl };
}

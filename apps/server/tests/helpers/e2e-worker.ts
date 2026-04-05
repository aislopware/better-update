import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";

import { unstable_startWorker } from "wrangler";

const devVarsPath = ".dev.vars";

const devVars = `BETTER_AUTH_SECRET=e2e-test-secret-that-is-at-least-32-chars
BETTER_AUTH_URL=http://localhost
DASHBOARD_URL=http://localhost
GITHUB_CLIENT_ID=e2e-github-id
GITHUB_CLIENT_SECRET=e2e-github-secret
`;

export function setupE2EWorker(persistDir: string): { getBaseUrl: () => string } {
  let worker: Awaited<ReturnType<typeof unstable_startWorker>>;
  let baseUrl: string;

  beforeAll(async () => {
    rmSync(persistDir, { recursive: true, force: true });
    writeFileSync(devVarsPath, devVars);

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
    rmSync(devVarsPath, { force: true });
  });

  return { getBaseUrl: () => baseUrl };
}

import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

import { unstable_startWorker } from "wrangler";

import { applyProcessEnv, createServerE2EEnvironment } from "./e2e-env";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");

export function setupE2EWorker(persistDir: string): { getBaseUrl: () => string } {
  let worker: Awaited<ReturnType<typeof unstable_startWorker>>;
  let baseUrl: string;
  let restoreProcessEnv: (() => void) | undefined;
  const persistPath = resolve(PROJECT_ROOT, persistDir);

  beforeAll(async () => {
    rmSync(persistPath, { recursive: true, force: true });
    const e2eEnv = createServerE2EEnvironment({ projectRoot: PROJECT_ROOT });
    restoreProcessEnv = applyProcessEnv(e2eEnv.processOverrides);

    execSync(`bunx wrangler d1 migrations apply DB --local --persist-to ${persistDir}`, {
      cwd: PROJECT_ROOT,
      env: e2eEnv.wranglerEnv,
      stdio: "pipe",
    });

    const originalCwd = process.cwd();

    process.chdir(PROJECT_ROOT);
    try {
      worker = await unstable_startWorker({
        config: resolve(PROJECT_ROOT, "wrangler.jsonc"),
        envFiles: [],
        bindings: e2eEnv.workerBindings,
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
    restoreProcessEnv?.();
    rmSync(persistPath, { recursive: true, force: true });
  });

  return { getBaseUrl: () => baseUrl };
}

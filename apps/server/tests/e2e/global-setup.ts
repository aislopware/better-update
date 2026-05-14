import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";

import { unstable_startWorker } from "wrangler";

import { applyProcessEnv, createServerE2EEnvironment } from "../helpers/e2e-env";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const PERSIST_DIR = ".wrangler/state/e2e-shared";
const ENV_FILE = resolve(PROJECT_ROOT, ".wrangler/.e2e-shared-env.json");

export interface SharedE2EEnv {
  readonly baseUrl: string;
  readonly persistDir: string;
}

const pickFreePort = () =>
  new Promise<number>((resolvePort, rejectPort) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", rejectPort);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      if (address === null || typeof address === "string") {
        srv.close();
        rejectPort(new Error("Failed to acquire free port"));
        return;
      }
      const { port } = address;
      srv.close(() => resolvePort(port));
    });
  });

export default async function setup() {
  const persistPath = resolve(PROJECT_ROOT, PERSIST_DIR);
  rmSync(persistPath, { recursive: true, force: true });

  const port = await pickFreePort();
  const publicApiUrl = `http://127.0.0.1:${String(port)}`;
  const e2eEnv = createServerE2EEnvironment({ projectRoot: PROJECT_ROOT, publicApiUrl });
  const restoreProcessEnv = applyProcessEnv(e2eEnv.processOverrides);

  // ── D1 migrations (once) ───────────────────────────────────────────────
  execSync(`bunx wrangler d1 migrations apply DB --local --persist-to ${PERSIST_DIR}`, {
    cwd: PROJECT_ROOT,
    env: e2eEnv.wranglerEnv,
    stdio: "pipe",
  });

  // ── Worker (once, shared across all test files) ────────────────────────
  const originalCwd = process.cwd();
  process.chdir(PROJECT_ROOT);
  let worker: Awaited<ReturnType<typeof unstable_startWorker>>;
  try {
    worker = await unstable_startWorker({
      config: resolve(PROJECT_ROOT, "wrangler.jsonc"),
      envFiles: [],
      bindings: e2eEnv.workerBindings,
      build: { nodejsCompatMode: "v2" },
      dev: {
        server: { port },
        inspector: false,
        logLevel: "error",
        persist: persistPath,
      },
    });
  } finally {
    process.chdir(originalCwd);
  }

  const url = await worker.url;
  const baseUrl = url.href.replace(/\/$/, "");

  const sharedEnv: SharedE2EEnv = { baseUrl, persistDir: PERSIST_DIR };
  writeFileSync(ENV_FILE, JSON.stringify(sharedEnv));

  return async () => {
    rmSync(ENV_FILE, { force: true });
    await worker.dispose();
    restoreProcessEnv();
    rmSync(persistPath, { recursive: true, force: true });
  };
}

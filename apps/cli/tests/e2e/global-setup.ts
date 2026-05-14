import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";

import { applyProcessEnv, createServerE2EEnvironment } from "../../../server/tests/helpers/e2e-env";

import type { unstable_startWorker } from "../../../server/node_modules/wrangler";

const SERVER_DIR = resolve(import.meta.dirname, "../../../server");
const PERSIST_DIR = ".wrangler/state/e2e-cli-shared";
const ENV_FILE = resolve(SERVER_DIR, ".wrangler/.e2e-cli-shared-env.json");

export interface SharedCliE2EEnv {
  readonly baseUrl: string;
  readonly persistDir: string;
}

const pickFreePort = async () =>
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
  const persistPath = resolve(SERVER_DIR, PERSIST_DIR);
  rmSync(persistPath, { recursive: true, force: true });

  const port = await pickFreePort();
  const publicApiUrl = `http://127.0.0.1:${String(port)}`;
  const e2eEnv = createServerE2EEnvironment({ projectRoot: SERVER_DIR, publicApiUrl });
  const restoreProcessEnv = applyProcessEnv(e2eEnv.processOverrides);

  execSync(`bunx wrangler d1 migrations apply DB --local --persist-to ${PERSIST_DIR}`, {
    cwd: SERVER_DIR,
    env: e2eEnv.wranglerEnv,
    stdio: "pipe",
  });

  const originalCwd = process.cwd();
  process.chdir(SERVER_DIR);
  let worker: Awaited<ReturnType<typeof unstable_startWorker>>;
  try {
    const { unstable_startWorker: startWorker } =
      await import("../../../server/node_modules/wrangler");
    worker = await startWorker({
      config: resolve(SERVER_DIR, "wrangler.jsonc"),
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

  const sharedEnv: SharedCliE2EEnv = { baseUrl, persistDir: PERSIST_DIR };
  writeFileSync(ENV_FILE, JSON.stringify(sharedEnv));

  return async () => {
    rmSync(ENV_FILE, { force: true });
    await worker.dispose();
    restoreProcessEnv();
    rmSync(persistPath, { recursive: true, force: true });
  };
}

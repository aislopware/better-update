import { execSync, spawn } from "node:child_process";
import { once } from "node:events";
import { rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { env } from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

import { chromium } from "playwright";
import { unstable_startWorker } from "wrangler";

import type { BrowserServer } from "playwright";

import { applyProcessEnv, createServerE2EEnvironment } from "../../../server/tests/helpers/e2e-env";

const API_DIR = resolve(import.meta.dirname, "../../../server");
const WEB_DIR = resolve(import.meta.dirname, "../..");
const WEB_PORT = 6780;
const PERSIST_DIR = ".wrangler/state/e2e-web-shared";

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

export const ENV_FILE = resolve(import.meta.dirname, ".e2e-shared-env.json");

export interface SharedE2EEnv {
  readonly baseUrl: string;
  readonly workerUrl: string;
  readonly browserWSEndpoint: string;
  readonly persistDir: string;
}

const waitForWeb = async () => {
  const deadline = Date.now() + 30_000;

  const poll = async (): Promise<void> => {
    const ready = await fetch(`http://127.0.0.1:${String(WEB_PORT)}/`).then(
      (response) => response.ok,
      () => false,
    );

    if (ready) {
      return;
    }

    if (Date.now() >= deadline) {
      throw new Error("Web dev server did not become ready within 30s");
    }

    await sleep(250);
    return poll();
  };

  return poll();
};

const waitForChildExit = async (child: ReturnType<typeof spawn>): Promise<void> => {
  if (child.exitCode !== null) {
    return;
  }
  await Promise.race([once(child, "exit"), sleep(3000)]);
};

export default async function setup() {
  const persistPath = resolve(API_DIR, PERSIST_DIR);
  rmSync(persistPath, { recursive: true, force: true });

  const workerPort = await pickFreePort();
  const publicApiUrl = `http://127.0.0.1:${String(workerPort)}`;
  const e2eEnv = createServerE2EEnvironment({
    projectRoot: API_DIR,
    webUrl: `http://127.0.0.1:${String(WEB_PORT)}`,
    publicApiUrl,
  });
  const restoreProcessEnv = applyProcessEnv(e2eEnv.processOverrides);

  // ── D1 migrations ──────────────────────────────────────────────────────
  execSync(`bunx wrangler d1 migrations apply DB --local --persist-to ${PERSIST_DIR}`, {
    cwd: API_DIR,
    env: e2eEnv.wranglerEnv,
    stdio: "pipe",
  });

  // ── Wrangler Worker ────────────────────────────────────────────────────
  const originalCwd = process.cwd();
  process.chdir(API_DIR);
  let worker: Awaited<ReturnType<typeof unstable_startWorker>>;
  try {
    worker = await unstable_startWorker({
      config: resolve(API_DIR, "wrangler.jsonc"),
      envFiles: [],
      bindings: e2eEnv.workerBindings,
      build: { nodejsCompatMode: "v2" },
      dev: {
        server: { port: workerPort },
        inspector: false,
        logLevel: "error",
        persist: persistPath,
      },
    });
  } finally {
    process.chdir(originalCwd);
  }

  const url = await worker.url;
  const apiBaseUrl = url.href.replace(/\/$/, "").replace("localhost", "127.0.0.1");

  // ── Vite dev server ────────────────────────────────────────────────────
  const webDev = spawn(
    "bun",
    ["x", "vite", "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"],
    {
      cwd: WEB_DIR,
      detached: true,
      env: {
        ...env,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
        WEB_API_PROXY_TARGET: apiBaseUrl,
        API_URL: apiBaseUrl,
        // Clear portless domain VITE_API_URL so E2E hits the local worker via proxy.
        VITE_API_URL: "",
      },
      stdio: "pipe",
    },
  );
  await waitForWeb();

  // ── Chromium ───────────────────────────────────────────────────────────
  const browserServer: BrowserServer = await chromium.launchServer();

  // ── Write shared env for test files ────────────────────────────────────
  const sharedEnv: SharedE2EEnv = {
    baseUrl: `http://127.0.0.1:${String(WEB_PORT)}`,
    workerUrl: apiBaseUrl,
    browserWSEndpoint: browserServer.wsEndpoint(),
    persistDir: PERSIST_DIR,
  };
  writeFileSync(ENV_FILE, JSON.stringify(sharedEnv));

  // ── Teardown ───────────────────────────────────────────────────────────
  return async () => {
    rmSync(ENV_FILE, { force: true });
    await browserServer.close();

    const child = webDev;
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      await waitForChildExit(child);
    }

    await worker.dispose();
    restoreProcessEnv();
    rmSync(persistPath, { recursive: true, force: true });
  };
}

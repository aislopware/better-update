import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { env } from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

import { chromium } from "playwright";

import type { BrowserServer } from "playwright";

import { startServerE2EStack } from "../../../server/tests/helpers/e2e-harness";
import { E2E_BROWSER_WS_ENV, E2E_WEB_URL_ENV } from "../helpers/e2e-shared-env";

const WEB_DIR = path.resolve(import.meta.dirname, "../..");
const WEB_PORT = 6780;

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

const startStack = async (): Promise<() => Promise<void>> => {
  // ── API Worker (wrangler test harness: D1 migrations + real HTTP port) ──
  // better-auth's baseURL — and therefore the only trusted Origin — must be the
  // web origin, because every request the browser and the API tests make
  // originates there and reaches the worker through the vite dev proxy.
  const stack = await startServerE2EStack({ webUrl: `http://127.0.0.1:${String(WEB_PORT)}` });
  const apiBaseUrl = stack.baseUrl;

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

  // ── Publish the stack for the test workers ─────────────────────────────
  // `process.env`, not a file on disk: vitest snapshots it when it forks each
  // project's workers, and it does so after globalSetup resolves. The server
  // Worker's own URLs are published by `startServerE2EStack`.
  env[E2E_WEB_URL_ENV] = `http://127.0.0.1:${String(WEB_PORT)}`;
  env[E2E_BROWSER_WS_ENV] = browserServer.wsEndpoint();

  // ── Teardown ───────────────────────────────────────────────────────────
  return async () => {
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

    await stack.stop();
  };
};

const SHARED_STACK_KEY = "__betterUpdateWebE2EStack";

interface SharedStack {
  readonly ready: Promise<() => Promise<void>>;
  refCount: number;
}

/**
 * Both the `e2e-api` and `e2e-browser` projects name this file as their
 * globalSetup, and vitest runs it once per project inside the same process.
 * Left unguarded the second run wipes the D1 state the first one is already
 * serving from and loses the race for the `--strictPort` web port, which reads
 * downstream as every authenticated request failing. Share one stack instead
 * and tear it down once the last project has released it.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const host = globalThis as unknown as Record<string, SharedStack | undefined>;
  const shared = (host[SHARED_STACK_KEY] ??= { ready: startStack(), refCount: 0 });
  shared.refCount += 1;
  const stop = await shared.ready;

  return async () => {
    shared.refCount -= 1;
    if (shared.refCount > 0) {
      return;
    }
    host[SHARED_STACK_KEY] = undefined;
    await stop();
  };
}

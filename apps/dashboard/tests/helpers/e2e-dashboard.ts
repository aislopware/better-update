import { execSync, spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

import { unstable_startWorker } from "wrangler";

const API_DIR = resolve(import.meta.dirname, "../../../server");
const DASHBOARD_DIR = resolve(import.meta.dirname, "../..");
const DASHBOARD_PORT = 6780;

const envLocal = `BETTER_AUTH_SECRET=e2e-test-secret-that-is-at-least-32-chars
TEST_MODE=true
GITHUB_CLIENT_ID=e2e-github-id
GITHUB_CLIENT_SECRET=e2e-github-secret
R2_ACCESS_KEY_ID=e2e-r2-access-key
R2_SECRET_ACCESS_KEY=e2e-r2-secret-key
INSTALL_TOKEN_SECRET=e2e-install-token-secret-at-least-32-chars
ASSET_CDN_URL=https://assets.better-update.dev
VAULT_KEYRING={"1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="}
`;

const parseCookies = (response: Response): string => {
  const raw = response.headers.get("set-cookie") ?? "";
  if (!raw) {
    return "";
  }
  return raw
    .split(/, (?=\w+=)/)
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
};

export const setupE2EDashboard = (persistDir: string) => {
  const state = {
    worker: null as Awaited<ReturnType<typeof unstable_startWorker>> | null,
    dashboardDev: null as ReturnType<typeof spawn> | null,
    baseUrl: "",
  };

  const envLocalPath = resolve(API_DIR, ".env.local");
  const persistPath = resolve(API_DIR, persistDir);
  const seedFile = resolve(API_DIR, ".wrangler/seed-dashboard-e2e.sql");

  const waitForDashboard = async () => {
    const deadline = Date.now() + 30_000;

    const poll = async (): Promise<void> => {
      const ready = await fetch(`http://127.0.0.1:${String(DASHBOARD_PORT)}/`).then(
        (response) => response.ok,
        () => false,
      );

      if (ready) {
        return;
      }

      if (Date.now() >= deadline) {
        throw new Error("Dashboard dev server did not become ready");
      }

      await sleep(250);
      return poll();
    };

    return poll();
  };

  const seedSql = (sql: string) => {
    writeFileSync(seedFile, sql);
    try {
      execSync(
        `bunx wrangler d1 execute DB --local --persist-to ${persistDir} --file ${seedFile}`,
        {
          cwd: API_DIR,
          stdio: "pipe",
        },
      );
    } finally {
      rmSync(seedFile, { force: true });
    }
  };

  beforeAll(async () => {
    rmSync(persistPath, { recursive: true, force: true });
    writeFileSync(envLocalPath, envLocal);

    execSync(`bunx wrangler d1 migrations apply DB --local --persist-to ${persistDir}`, {
      cwd: API_DIR,
      stdio: "pipe",
    });

    const originalCwd = process.cwd();

    process.chdir(API_DIR);
    try {
      state.worker = await unstable_startWorker({
        config: resolve(API_DIR, "wrangler.jsonc"),
        build: { nodejsCompatMode: "v2" },
        dev: { server: { port: 0 }, inspector: false, logLevel: "error", persist: persistPath },
      });
    } finally {
      process.chdir(originalCwd);
    }

    const url = await state.worker.url;
    const apiBaseUrl = url.href.replace(/\/$/, "");

    state.dashboardDev = spawn(
      "bun",
      ["x", "vite", "--host", "127.0.0.1", "--port", String(DASHBOARD_PORT), "--strictPort"],
      {
        cwd: DASHBOARD_DIR,
        env: {
          ...env,
          FORCE_COLOR: "0",
          NO_COLOR: "1",
          DASHBOARD_API_PROXY_TARGET: apiBaseUrl,
        },
        stdio: "pipe",
      },
    );
    await waitForDashboard();
    state.baseUrl = `http://127.0.0.1:${String(DASHBOARD_PORT)}`;
  });

  afterAll(async () => {
    state.dashboardDev?.kill("SIGTERM");
    await state.worker?.dispose();
    rmSync(persistPath, { recursive: true, force: true });
    rmSync(envLocalPath, { force: true });
    rmSync(seedFile, { force: true });
  });

  const post = async (path: string, body: unknown, headers?: Record<string, string>) =>
    fetch(`${state.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  const get = async (path: string, headers?: Record<string, string>) =>
    fetch(`${state.baseUrl}${path}`, headers ? { headers } : {});

  const del = async (path: string, body: unknown, headers?: Record<string, string>) =>
    fetch(`${state.baseUrl}${path}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  const patch = async (path: string, body: unknown, headers?: Record<string, string>) =>
    fetch(`${state.baseUrl}${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  return { getBaseUrl: () => state.baseUrl, post, get, del, patch, seedSql, parseCookies };
};

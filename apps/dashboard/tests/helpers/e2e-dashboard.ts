import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { unstable_startWorker } from "wrangler";

const API_DIR = resolve(import.meta.dirname, "../../../server");

const envLocal = `BETTER_AUTH_SECRET=e2e-test-secret-that-is-at-least-32-chars
TEST_MODE=true
GITHUB_CLIENT_ID=e2e-github-id
GITHUB_CLIENT_SECRET=e2e-github-secret
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
    baseUrl: "",
  };

  const envLocalPath = resolve(API_DIR, ".env.local");
  const persistPath = resolve(API_DIR, persistDir);

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
    state.baseUrl = url.href.replace(/\/$/, "");
  });

  afterAll(async () => {
    await state.worker?.dispose();
    rmSync(persistPath, { recursive: true, force: true });
    rmSync(envLocalPath, { force: true });
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

  return { getBaseUrl: () => state.baseUrl, post, get, del, patch, parseCookies };
};

import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { unstable_startWorker } from "wrangler";

const API_DIR = resolve(import.meta.dirname, "../../../api");

const devVars = `BETTER_AUTH_SECRET=e2e-test-secret-that-is-at-least-32-chars
BETTER_AUTH_URL=http://localhost
DASHBOARD_URL=http://localhost
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

  const devVarsPath = resolve(API_DIR, ".dev.vars");

  beforeAll(async () => {
    rmSync(resolve(API_DIR, persistDir), { recursive: true, force: true });
    writeFileSync(devVarsPath, devVars);

    execSync(`bunx wrangler d1 migrations apply DB --local --persist-to ${persistDir}`, {
      cwd: API_DIR,
      stdio: "pipe",
    });

    state.worker = await unstable_startWorker({
      config: resolve(API_DIR, "wrangler.jsonc"),
      dev: { server: { port: 0 }, inspector: false, persist: resolve(API_DIR, persistDir) },
    });

    const url = await state.worker.url;
    state.baseUrl = url.href.replace(/\/$/, "");
  });

  afterAll(async () => {
    await state.worker?.dispose();
    rmSync(resolve(API_DIR, persistDir), { recursive: true, force: true });
    rmSync(devVarsPath, { force: true });
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

  return { getBaseUrl: () => state.baseUrl, post, get, del, parseCookies };
};

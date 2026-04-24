import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";

import { unstable_startWorker } from "wrangler";

import { applyProcessEnv, createServerE2EEnvironment } from "./e2e-env";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");

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

const parseCookies = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");

const jsonRequest = (
  getBaseUrl: () => string,
  method: "POST" | "PATCH" | "PUT",
  path: string,
  body: unknown,
  headers?: Record<string, string>,
) =>
  fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

export function setupE2EWorker(persistDir: string) {
  let worker: Awaited<ReturnType<typeof unstable_startWorker>>;
  let baseUrl: string;
  let restoreProcessEnv: (() => void) | undefined;
  const persistPath = resolve(PROJECT_ROOT, persistDir);

  beforeAll(async () => {
    rmSync(persistPath, { recursive: true, force: true });
    const port = await pickFreePort();
    const publicApiUrl = `http://127.0.0.1:${port}`;
    const e2eEnv = createServerE2EEnvironment({ projectRoot: PROJECT_ROOT, publicApiUrl });
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
    baseUrl = url.href.replace(/\/$/, "");
  });

  afterAll(async () => {
    await worker?.dispose();
    restoreProcessEnv?.();
    rmSync(persistPath, { recursive: true, force: true });
  });

  const getBaseUrl = () => baseUrl;

  return {
    getBaseUrl,
    parseCookies,
    get: (path: string, headers?: Record<string, string>) =>
      fetch(`${getBaseUrl()}${path}`, headers ? { headers } : {}),
    post: (path: string, body: unknown, headers?: Record<string, string>) =>
      jsonRequest(getBaseUrl, "POST", path, body, headers),
    patch: (path: string, body: unknown, headers?: Record<string, string>) =>
      jsonRequest(getBaseUrl, "PATCH", path, body, headers),
    put: (path: string, body: unknown, headers?: Record<string, string>) =>
      jsonRequest(getBaseUrl, "PUT", path, body, headers),
    del: (path: string, headers?: Record<string, string>) =>
      fetch(`${getBaseUrl()}${path}`, { method: "DELETE", ...(headers ? { headers } : {}) }),
    postNoBody: (path: string, headers?: Record<string, string>) =>
      fetch(`${getBaseUrl()}${path}`, { method: "POST", ...(headers ? { headers } : {}) }),
    putAbsolute: (url: string, body: BodyInit, headers?: Record<string, string>) =>
      fetch(url, { method: "PUT", ...(headers ? { headers } : {}), body }),
  };
}

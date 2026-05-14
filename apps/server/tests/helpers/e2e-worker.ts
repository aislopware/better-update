import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const ENV_FILE = resolve(PROJECT_ROOT, ".wrangler/.e2e-shared-env.json");

interface SharedE2EEnv {
  readonly baseUrl: string;
  readonly persistDir: string;
}

let cachedEnv: SharedE2EEnv | undefined;

const readSharedEnv = (): SharedE2EEnv => {
  if (cachedEnv) return cachedEnv;
  const raw = readFileSync(ENV_FILE, "utf8");
  cachedEnv = JSON.parse(raw) as SharedE2EEnv;
  return cachedEnv;
};

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

/**
 * E2E HTTP client backed by a worker started by the e2e globalSetup.
 *
 * The legacy `persistDir` argument is accepted for backwards compatibility
 * with existing test files but is intentionally ignored — there is now a
 * single shared worker + D1 instance for the whole suite. Test files keep
 * collisions away by using unique emails / org slugs (verified across all
 * 24 e2e files in `tests/e2e/`).
 */
export function setupE2EWorker(_persistDir?: string) {
  const getBaseUrl = () => readSharedEnv().baseUrl;
  const getPersistDir = () => readSharedEnv().persistDir;

  return {
    getBaseUrl,
    getPersistDir,
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

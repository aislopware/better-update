import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import nodePath from "node:path";

import { ENV_FILE } from "../e2e/global-setup";

import type { SharedE2EEnv } from "../e2e/global-setup";

const API_DIR = nodePath.resolve(import.meta.dirname, "../../../server");

let cachedEnv: SharedE2EEnv | undefined;

const getSharedEnv = (): SharedE2EEnv => {
  cachedEnv ??= JSON.parse(readFileSync(ENV_FILE, "utf8")) as SharedE2EEnv;
  return cachedEnv;
};

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

// better-auth force-validates the Origin as soon as a request carries any
// Sec-Fetch-* hint, and Node's fetch always sends `sec-fetch-mode: cors`.
// Without an Origin these calls get 403 MISSING_OR_NULL_ORIGIN; the web origin
// is the trusted one (it is better-auth's baseURL under the e2e env), so send
// it and look like the browser calls these stand in for.
const withOrigin = (headers?: Record<string, string>): Record<string, string> => ({
  origin: getSharedEnv().baseUrl,
  ...headers,
});

export const setupE2EDashboard = () => {
  const post = async (path: string, body: unknown, headers?: Record<string, string>) =>
    fetch(`${getSharedEnv().baseUrl}${path}`, {
      method: "POST",
      headers: withOrigin({ "content-type": "application/json", ...headers }),
      body: JSON.stringify(body),
    });

  const get = async (path: string, headers?: Record<string, string>) =>
    fetch(`${getSharedEnv().baseUrl}${path}`, { headers: withOrigin(headers) });

  const del = async (path: string, body: unknown, headers?: Record<string, string>) =>
    fetch(`${getSharedEnv().baseUrl}${path}`, {
      method: "DELETE",
      headers: withOrigin({ "content-type": "application/json", ...headers }),
      body: JSON.stringify(body),
    });

  const patch = async (path: string, body: unknown, headers?: Record<string, string>) =>
    fetch(`${getSharedEnv().baseUrl}${path}`, {
      method: "PATCH",
      headers: withOrigin({ "content-type": "application/json", ...headers }),
      body: JSON.stringify(body),
    });

  const seedSql = (sql: string) => {
    const { persistDir } = getSharedEnv();
    // Unique per call: e2e-api files run concurrently and several seed via this
    // helper, so a shared file path would race (one file's writeFileSync clobbers
    // another's before its execSync reads it, seeding the wrong rows). randomUUID
    // keeps each seed write isolated even across vitest worker processes.
    const seedFile = nodePath.resolve(API_DIR, `.wrangler/seed-dashboard-${randomUUID()}.sql`);
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

  return {
    getBaseUrl: () => getSharedEnv().baseUrl,
    getWorkerUrl: () => getSharedEnv().workerUrl,
    post,
    get,
    del,
    patch,
    seedSql,
    parseCookies,
  };
};

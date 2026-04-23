import { execSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ENV_FILE } from "../e2e/global-setup";

import type { SharedE2EEnv } from "../e2e/global-setup";

const API_DIR = resolve(import.meta.dirname, "../../../server");

let _sharedEnv: SharedE2EEnv | undefined;

const getSharedEnv = (): SharedE2EEnv => {
  _sharedEnv ??= JSON.parse(readFileSync(ENV_FILE, "utf8")) as SharedE2EEnv;
  return _sharedEnv;
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

export const setupE2EDashboard = () => {
  const post = async (path: string, body: unknown, headers?: Record<string, string>) =>
    fetch(`${getSharedEnv().baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  const get = async (path: string, headers?: Record<string, string>) =>
    fetch(`${getSharedEnv().baseUrl}${path}`, headers ? { headers } : {});

  const del = async (path: string, body: unknown, headers?: Record<string, string>) =>
    fetch(`${getSharedEnv().baseUrl}${path}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  const patch = async (path: string, body: unknown, headers?: Record<string, string>) =>
    fetch(`${getSharedEnv().baseUrl}${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  const seedSql = (sql: string) => {
    const { persistDir } = getSharedEnv();
    const seedFile = resolve(API_DIR, ".wrangler/seed-dashboard-e2e.sql");
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

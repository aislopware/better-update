/**
 * Provisions the Cloudflare resources a deployment needs (D1 database, two KV
 * namespaces, three R2 buckets) on the account Wrangler is authenticated
 * against, then writes the resulting ids into `.env.deploy`.
 *
 * Safe to re-run: an existing resource is looked up instead of recreated, and
 * only the id keys are rewritten — every other line of `.env.deploy` is kept.
 *
 *   bun run bootstrap            # create + record
 *   bun run bootstrap --dry-run  # print what would be created
 *
 * Requires an authenticated Wrangler (`bunx wrangler login`) or CLOUDFLARE_API_TOKEN.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  loadDeployValues,
  OVERRIDES_EXAMPLE_FILE,
  OVERRIDES_FILE,
  REPO_ROOT,
} from "./deploy-config";

// eslint-disable-next-line node/no-process-env -- provisioning script: the CLI account/token come from the environment
const processEnv = process.env;
const dryRun = process.argv.includes("--dry-run");

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u;
const HEX32 = /\b[0-9a-f]{32}\b/u;

const relative = (file: string): string => path.relative(REPO_ROOT, file);

const wrangler = (args: readonly string[], accountId: string): string => {
  if (dryRun) {
    console.log(`  would run: wrangler ${args.join(" ")}`);
    return "";
  }
  return execFileSync("bunx", ["wrangler", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: accountId.length > 0 ? { ...processEnv, CLOUDFLARE_ACCOUNT_ID: accountId } : processEnv,
  });
};

/** Runs a wrangler command, returning `undefined` instead of throwing. */
const tryWrangler = (args: readonly string[], accountId: string): string | undefined => {
  try {
    return wrangler(args, accountId);
  } catch {
    return undefined;
  }
};

/** Wrangler prefixes JSON output with progress lines; parse the array tail. */
const parseJsonArray = (output: string): readonly unknown[] => {
  const start = output.indexOf("[");
  if (start < 0) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(output.slice(start));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** Dry runs never resolve an id — report the intent, not a failure. */
const reportStatus = (label: string, resolved: boolean, existed: boolean): void => {
  if (dryRun) {
    return;
  }
  console.log(`  ${label} — ${resolved ? (existed ? "already exists" : "created") : "FAILED"}`);
};

const createD1 = (name: string, accountId: string): string | undefined => {
  const fromCreate = UUID.exec(tryWrangler(["d1", "create", name], accountId) ?? "")?.[0];
  if (fromCreate !== undefined) {
    reportStatus(`D1 ${name}`, true, false);
    return fromCreate;
  }
  // Already there (or creation raced): read the id back.
  const existing = UUID.exec(tryWrangler(["d1", "info", name], accountId) ?? "")?.[0];
  reportStatus(`D1 ${name}`, existing !== undefined, true);
  return existing;
};

const isNamespace = (entry: unknown): entry is { id: string; title: string } =>
  typeof entry === "object" && entry !== null && "id" in entry && "title" in entry;

const createKv = (title: string, accountId: string): string | undefined => {
  const fromCreate = HEX32.exec(
    tryWrangler(["kv", "namespace", "create", title], accountId) ?? "",
  )?.[0];
  if (fromCreate !== undefined) {
    reportStatus(`KV ${title}`, true, false);
    return fromCreate;
  }
  const match = parseJsonArray(tryWrangler(["kv", "namespace", "list"], accountId) ?? "")
    .filter(isNamespace)
    // Wrangler prefixes namespace titles with the worker name when it creates
    // them from a config file; match either shape.
    .find((entry) => entry.title === title || entry.title.endsWith(`-${title}`));
  reportStatus(`KV ${title}`, match !== undefined, true);
  return match?.id;
};

const createBucket = (name: string, accountId: string): void => {
  const created = tryWrangler(["r2", "bucket", "create", name], accountId);
  if (!dryRun) {
    console.log(
      `  R2 ${name} — ${created === undefined ? "already exists (or failed)" : "created"}`,
    );
  }
};

/** Rewrites only the given keys, preserving comments, order and other keys. */
const updateOverrides = (updates: Record<string, string>): void => {
  if (!fs.existsSync(OVERRIDES_FILE)) {
    fs.copyFileSync(OVERRIDES_EXAMPLE_FILE, OVERRIDES_FILE);
    console.log(`Created ${relative(OVERRIDES_FILE)} from the example.`);
  }
  const applied = new Set<string>();
  const lines = fs
    .readFileSync(OVERRIDES_FILE, "utf8")
    .split("\n")
    .map((line) => {
      const key = Object.keys(updates).find((candidate) => line.startsWith(`${candidate}=`));
      if (key === undefined) {
        return line;
      }
      applied.add(key);
      return `${key}=${updates[key] ?? ""}`;
    });
  const appended = Object.entries(updates)
    .filter(([key]) => !applied.has(key))
    .map(([key, value]) => `${key}=${value}`);

  fs.writeFileSync(
    OVERRIDES_FILE,
    [...lines, ...(appended.length > 0 ? ["", "# Added by `bun run bootstrap`", ...appended] : [])]
      .join("\n")
      .replace(/\n{3,}$/u, "\n"),
  );
};

const main = (): void => {
  const values = loadDeployValues();
  const read = (key: string, fallback: string): string => {
    const value = values[key] ?? "";
    return value.length > 0 ? value : fallback;
  };

  const accountId = read("BU_CF_ACCOUNT_ID", "");
  const workerName = read("BU_SERVER_WORKER_NAME", "better-update-server");
  const d1Name = read("BU_D1_DATABASE_NAME", "better-update");
  const buckets = [
    read("BU_R2_ASSETS_BUCKET", "better-update-assets"),
    read("BU_R2_BUILDS_BUCKET", "better-update-builds"),
    read("BU_R2_CREDENTIALS_BUCKET", "better-update-credentials"),
  ];

  console.log(
    `Provisioning on account ${accountId.length > 0 ? accountId : "(wrangler default)"}${
      dryRun ? " — DRY RUN" : ""
    }`,
  );

  const d1Id = createD1(d1Name, accountId);
  const sessionKvId = createKv(`${workerName}-SESSION_KV`, accountId);
  const reservationsKvId = createKv(`${workerName}-BUILD_RESERVATIONS`, accountId);
  for (const bucket of buckets) {
    createBucket(bucket, accountId);
    // Preview buckets back the R2 e2e suite; harmless to have, required to run it.
    createBucket(`${bucket}-e2e`, accountId);
  }

  if (dryRun) {
    return;
  }

  const updates = {
    ...(d1Id === undefined ? {} : { BU_D1_DATABASE_ID: d1Id }),
    ...(sessionKvId === undefined ? {} : { BU_KV_SESSION_ID: sessionKvId }),
    ...(reservationsKvId === undefined ? {} : { BU_KV_BUILD_RESERVATIONS_ID: reservationsKvId }),
  };
  updateOverrides(updates);

  const missing = ["BU_D1_DATABASE_ID", "BU_KV_SESSION_ID", "BU_KV_BUILD_RESERVATIONS_ID"].filter(
    (key) => !(key in updates),
  );
  console.log(
    missing.length === 0
      ? `\nWrote ${Object.keys(updates).length} id(s) to ${relative(OVERRIDES_FILE)}.\nNext: bun run config:gen`
      : `\nCould NOT resolve ${missing.join(", ")} — check the wrangler output above and fill them in ${relative(OVERRIDES_FILE)} by hand.`,
  );
};

main();

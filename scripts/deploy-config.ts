/**
 * Resolves the deployment identity (account ids, hostnames, resource names)
 * that every generated config artifact is rendered from.
 *
 * The repository is deployment-neutral: NO account id, hostname or resource id
 * is tracked in git. Values come from, highest first:
 *   1. `process.env` — CI variables, per-command one-offs
 *   2. `.env.deploy` — the untracked per-instance file (see `.env.deploy.example`)
 *   3. the generic fallbacks in KEYS below — names only, never identity
 *
 * Only `BU_`-prefixed keys are read from `process.env`, so an exported
 * `R2_ACCESS_KEY_ID` (used for local dev + the R2 e2e suite) can never leak
 * into a rendered Worker config.
 */
import fs from "node:fs";
import path from "node:path";

import { parseDotenvContent } from "../packages/dotenv/src/index";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..");

export const OVERRIDES_FILE = path.join(REPO_ROOT, ".env.deploy");
export const OVERRIDES_EXAMPLE_FILE = path.join(REPO_ROOT, ".env.deploy.example");

/**
 * Every key the deployment understands, and what happens when it is unset.
 *
 * `required` — generation fails without it; these are the values that identify
 * ONE deployment (account, host, resource ids) and are deliberately absent from
 * the repository. Everything else falls back to a generic name or to "off".
 */
const KEYS = {
  BU_CF_ACCOUNT_ID: { required: true },
  BU_CF_ZONE_ID: { fallback: "" },
  BU_SERVER_WORKER_NAME: { fallback: "better-update-server" },
  BU_WEB_WORKER_NAME: { fallback: "better-update-web" },
  BU_APP_HOST: { required: true },
  BU_VAULT_HOST: { fallback: "" },
  BU_ASSET_CDN_HOST: { required: true },
  BU_D1_DATABASE_NAME: { fallback: "better-update" },
  BU_D1_DATABASE_ID: { required: true },
  BU_KV_SESSION_ID: { required: true },
  BU_KV_BUILD_RESERVATIONS_ID: { required: true },
  BU_R2_ASSETS_BUCKET: { fallback: "better-update-assets" },
  BU_R2_BUILDS_BUCKET: { fallback: "better-update-builds" },
  BU_R2_CREDENTIALS_BUCKET: { fallback: "better-update-credentials" },
  BU_R2_ACCESS_KEY_ID: { fallback: "" },
  BU_ANALYTICS_DATASET: { fallback: "update_events" },
  BU_EMAIL_SENDER: { required: true },
  BU_LEGAL_EMAIL: { fallback: "" },
  BU_SUPERADMIN_EMAILS: { fallback: "" },
  BU_GITHUB_CLIENT_ID: { fallback: "" },
  BU_GOOGLE_CLIENT_ID: { fallback: "" },
} as const satisfies Record<string, { required: true } | { fallback: string }>;

export const DEPLOY_KEYS = Object.keys(KEYS);

/**
 * Stand-ins used when no deployment identity is configured, so that a fresh
 * clone still installs, typechecks, tests and runs `vite dev` against local
 * emulated storage. They are deliberately unusable against Cloudflare — the
 * deploy path resolves the config in strict mode and refuses them.
 */
const PLACEHOLDERS: Record<string, string> = {
  BU_CF_ACCOUNT_ID: "0".repeat(32),
  BU_APP_HOST: "localhost",
  BU_D1_DATABASE_ID: "00000000-0000-0000-0000-000000000000",
  BU_KV_SESSION_ID: "0".repeat(32),
  BU_KV_BUILD_RESERVATIONS_ID: "0".repeat(32),
  BU_EMAIL_SENDER: "noreply@localhost",
  BU_ASSET_CDN_HOST: "localhost",
};

export interface DeployConfig {
  readonly accountId: string;
  /** Empty when the deployment has no custom domain (workers.dev only). */
  readonly zoneId: string;
  readonly serverWorkerName: string;
  readonly webWorkerName: string;
  readonly appHost: string;
  /** Empty when the isolated env-vault origin is disabled. */
  readonly vaultHost: string;
  readonly appUrl: string;
  /** Origin OTA assets are served from — an R2 custom domain, not the Worker. */
  readonly assetCdnUrl: string;
  readonly d1DatabaseName: string;
  readonly d1DatabaseId: string;
  readonly kvSessionId: string;
  readonly kvBuildReservationsId: string;
  readonly r2AssetsBucket: string;
  readonly r2BuildsBucket: string;
  readonly r2CredentialsBucket: string;
  readonly r2AccessKeyId: string;
  readonly analyticsDataset: string;
  readonly emailSender: string;
  readonly legalEmail: string;
  readonly superadminEmails: string;
  readonly githubClientId: string;
  readonly googleClientId: string;
}

export class DeployConfigError extends Error {}

const readEnvFile = (file: string): Record<string, string> =>
  fs.existsSync(file) ? parseDotenvContent(fs.readFileSync(file, "utf8")) : {};

/**
 * Raw merged key/value view — unvalidated, for tooling that fills the gaps.
 * Resolution runs over the KEYS registry rather than over whichever keys happen
 * to be in a file, so CI can supply every value through the environment alone.
 */
export const loadDeployValues = (): Record<string, string> => {
  const fromFile = readEnvFile(OVERRIDES_FILE);
  return Object.fromEntries(
    DEPLOY_KEYS.map((key) => [
      key,
      // eslint-disable-next-line node/no-process-env -- build script: process.env IS the override channel
      process.env[key] ?? fromFile[key] ?? "",
    ]),
  );
};

const missingRequired = (values: Record<string, string>): readonly string[] =>
  Object.entries(KEYS)
    .filter(([key, spec]) => "required" in spec && (values[key] ?? "").length === 0)
    .map(([key]) => key);

const assertRequired = (values: Record<string, string>): void => {
  const missing = missingRequired(values);
  if (missing.length === 0) {
    return;
  }
  const hint = fs.existsSync(OVERRIDES_FILE)
    ? `Set them in ${path.relative(REPO_ROOT, OVERRIDES_FILE)} or in the environment.`
    : `No ${path.relative(REPO_ROOT, OVERRIDES_FILE)} found — run \`cp .env.deploy.example .env.deploy\`, ` +
      "then `bun run bootstrap` to create the Cloudflare resources.";
  throw new DeployConfigError(
    `This repository ships no deployment identity. Missing ${missing.join(", ")}. ${hint}`,
  );
};

/** Drops empty entries so a placeholder underneath can show through. */
const compactValues = (values: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value.length > 0));

/** Generic name fallbacks; identity keys are required and never defaulted. */
const withFallbacks = (values: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(KEYS).map(([key, spec]) => {
      const value = values[key] ?? "";
      return [key, value.length > 0 || "required" in spec ? value : spec.fallback];
    }),
  );

const stripTrailingSlash = (value: string): string => value.replace(/\/$/u, "");

export interface LoadOptions {
  /**
   * Fail instead of substituting placeholders for the required identity keys.
   * Every path that talks to Cloudflare (deploy, remote migrations) uses this.
   */
  readonly strict: boolean;
}

/** Which required keys were filled with a placeholder, if any. */
export const placeholderKeys = (): readonly string[] => missingRequired(loadDeployValues());

export const loadDeployConfig = (options: LoadOptions = { strict: true }): DeployConfig => {
  const resolved = loadDeployValues();
  if (options.strict) {
    assertRequired(resolved);
  }
  const values = withFallbacks({ ...PLACEHOLDERS, ...compactValues(resolved) });
  const read = (key: string): string => values[key] ?? "";
  const appUrl = stripTrailingSlash(`https://${read("BU_APP_HOST")}`);
  const assetCdnHost = read("BU_ASSET_CDN_HOST");
  const emailSender = read("BU_EMAIL_SENDER");
  const legalEmail = read("BU_LEGAL_EMAIL");

  return {
    accountId: read("BU_CF_ACCOUNT_ID"),
    zoneId: read("BU_CF_ZONE_ID"),
    serverWorkerName: read("BU_SERVER_WORKER_NAME"),
    webWorkerName: read("BU_WEB_WORKER_NAME"),
    appHost: read("BU_APP_HOST"),
    vaultHost: read("BU_VAULT_HOST"),
    appUrl,
    assetCdnUrl: stripTrailingSlash(`https://${assetCdnHost}`),
    d1DatabaseName: read("BU_D1_DATABASE_NAME"),
    d1DatabaseId: read("BU_D1_DATABASE_ID"),
    kvSessionId: read("BU_KV_SESSION_ID"),
    kvBuildReservationsId: read("BU_KV_BUILD_RESERVATIONS_ID"),
    r2AssetsBucket: read("BU_R2_ASSETS_BUCKET"),
    r2BuildsBucket: read("BU_R2_BUILDS_BUCKET"),
    r2CredentialsBucket: read("BU_R2_CREDENTIALS_BUCKET"),
    r2AccessKeyId: read("BU_R2_ACCESS_KEY_ID"),
    analyticsDataset: read("BU_ANALYTICS_DATASET"),
    emailSender,
    // One contact address by default: an instance that sets no separate legal
    // address is reachable at the one it already sends mail from.
    legalEmail: legalEmail.length > 0 ? legalEmail : emailSender,
    superadminEmails: read("BU_SUPERADMIN_EMAILS"),
    githubClientId: read("BU_GITHUB_CLIENT_ID"),
    googleClientId: read("BU_GOOGLE_CLIENT_ID"),
  };
};

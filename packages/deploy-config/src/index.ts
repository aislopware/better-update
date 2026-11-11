/**
 * Resolves the deployment identity (account ids, hostnames, resource names)
 * that every deployment-specific config reads at load time: both Workers'
 * `cloudflare.config.ts`, the web app's `vite.config.ts` (build-time defines)
 * and the CLI's baked-in service defaults (a Bun macro).
 *
 * Nothing is rendered to disk. This module is imported by Node directly when
 * `cf` / the Cloudflare Vite plugin load `cloudflare.config.ts`, so it may only
 * import Node built-ins and workspace packages (which resolve to their source
 * by package name) — never a relative extensionless path.
 *
 * The repository is deployment-neutral: NO account id, hostname or resource id
 * is tracked in git. Values come from, highest first:
 *   1. `process.env` — CI variables, per-command one-offs
 *   2. `.env.deploy` — the untracked per-instance file (see `.env.deploy.example`)
 *   3. the generic fallbacks in KEYS below — names only, never identity
 *
 * Only `BU_`-prefixed keys are read from `process.env`, so an exported
 * `R2_ACCESS_KEY_ID` (used for local dev + the R2 e2e suite) can never leak
 * into a Worker config.
 */
import fs from "node:fs";
import path from "node:path";

import { parseDotenvContent } from "@better-update/dotenv";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

export const OVERRIDES_FILE = path.join(REPO_ROOT, ".env.deploy");
export const OVERRIDES_EXAMPLE_FILE = path.join(REPO_ROOT, ".env.deploy.example");

/**
 * Every key the deployment understands, and what happens when it is unset.
 *
 * `required` — a strict load fails without it; these are the values that identify
 * ONE deployment (account, host, resource ids) and are deliberately absent from
 * the repository. A non-strict load substitutes the `placeholder` instead, so a
 * fresh clone still installs, typechecks, tests and runs `vite dev` against
 * local emulated storage; placeholders are deliberately unusable against
 * Cloudflare. Everything else falls back to a generic name or to "off".
 */
const KEYS = {
  BU_CF_ACCOUNT_ID: { required: true, placeholder: "0".repeat(32) },
  BU_CF_ZONE_ID: { fallback: "" },
  BU_SERVER_WORKER_NAME: { fallback: "better-update-server" },
  BU_WEB_WORKER_NAME: { fallback: "better-update-web" },
  BU_APP_HOST: { required: true, placeholder: "localhost" },
  BU_VAULT_HOST: { fallback: "" },
  BU_ASSET_CDN_HOST: { required: true, placeholder: "localhost" },
  BU_D1_DATABASE_NAME: { fallback: "better-update" },
  BU_D1_DATABASE_ID: { required: true, placeholder: "00000000-0000-0000-0000-000000000000" },
  BU_KV_SESSION_ID: { required: true, placeholder: "0".repeat(32) },
  BU_KV_BUILD_RESERVATIONS_ID: { required: true, placeholder: "0".repeat(32) },
  BU_R2_ASSETS_BUCKET: { fallback: "better-update-assets" },
  BU_R2_BUILDS_BUCKET: { fallback: "better-update-builds" },
  BU_R2_CREDENTIALS_BUCKET: { fallback: "better-update-credentials" },
  BU_R2_ACCESS_KEY_ID: { fallback: "" },
  BU_ANALYTICS_DATASET: { fallback: "update_events" },
  BU_DELIVERY_ANALYTICS_DATASET: { fallback: "delivery_events" },
  BU_DESKTOP_ANALYTICS_DATASET: { fallback: "desktop_events" },
  BU_EMAIL_SENDER: { required: true, placeholder: "noreply@localhost" },
  BU_LEGAL_EMAIL: { fallback: "" },
  BU_SUPERADMIN_EMAILS: { fallback: "" },
  // Who may create an organization: `approved` (any approved user) or
  // `superadmin` (superadmins only; everyone else joins by invitation).
  BU_ORG_CREATION: { fallback: "approved" },
  BU_GITHUB_CLIENT_ID: { fallback: "" },
  BU_GOOGLE_CLIENT_ID: { fallback: "" },
  // GitHub `owner/repo` whose Releases carry the CLI binaries (`install.sh`,
  // the CLI's own update check). Defaults to the upstream project.
  BU_CLI_RELEASE_REPO: { fallback: "aislopware/better-update" },
} as const satisfies Record<string, KeySpec>;

type KeySpec =
  | { readonly required: true; readonly placeholder: string }
  | { readonly fallback: string };
type DeployKey = keyof typeof KEYS;

const DEPLOY_KEYS = Object.keys(KEYS);

/** What an unset key resolves to outside strict mode. */
const defaultOf = (key: DeployKey): string => {
  const spec: KeySpec = KEYS[key];
  return "fallback" in spec ? spec.fallback : spec.placeholder;
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
  /** Second AE dataset: bundle/patch delivery, written from the bundle route. */
  readonly deliveryAnalyticsDataset: string;
  /** Third AE dataset: desktop feed checks and downloads, written from `/feeds/*`. */
  readonly desktopAnalyticsDataset: string;
  readonly emailSender: string;
  readonly legalEmail: string;
  readonly superadminEmails: string;
  /** Who may create an organization. */
  readonly orgCreation: OrgCreationPolicy;
  readonly githubClientId: string;
  readonly googleClientId: string;
  /** GitHub `owner/repo` the CLI binaries are released from. */
  readonly cliReleaseRepo: string;
}

const readEnvFile = (file: string): Record<string, string> =>
  fs.existsSync(file) ? parseDotenvContent(fs.readFileSync(file, "utf8")) : {};

/**
 * The keys that are set, merged — unvalidated, for tooling that fills the gaps.
 * Resolution runs over the KEYS registry rather than over whichever keys happen
 * to be in a file, so CI can supply every value through the environment alone.
 * An empty value counts as unset, and an empty environment variable still hides
 * the file's value.
 */
export const loadDeployValues = (): Record<string, string> => {
  const fromFile = readEnvFile(OVERRIDES_FILE);
  return Object.fromEntries(
    DEPLOY_KEYS.flatMap((key) => {
      const value = process.env[key] ?? fromFile[key];
      return value === undefined || value.length === 0 ? [] : [[key, value]];
    }),
  );
};

const missingRequired = (values: Record<string, string>): readonly string[] =>
  Object.entries(KEYS)
    .filter(([key, spec]) => "required" in spec && values[key] === undefined)
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
  // eslint-disable-next-line functional/no-throw-statements -- config loader: a throw is how cf, Vite and Bun macros report an unusable config
  throw new Error(
    `This repository ships no deployment identity. Missing ${missing.join(", ")}. ${hint}`,
  );
};

/** Who may create an organization (`BU_ORG_CREATION`). */
export type OrgCreationPolicy = "approved" | "superadmin";

const ORG_CREATION_POLICIES: readonly OrgCreationPolicy[] = ["approved", "superadmin"];

const parseOrgCreation = (raw: string): OrgCreationPolicy => {
  const policy = ORG_CREATION_POLICIES.find((candidate) => candidate === raw.trim());
  if (policy === undefined) {
    // eslint-disable-next-line functional/no-throw-statements -- config loader: a throw is how cf, Vite and Bun macros report an unusable config
    throw new Error(
      `BU_ORG_CREATION must be one of ${ORG_CREATION_POLICIES.join(", ")}; got "${raw}".`,
    );
  }
  return policy;
};

const stripTrailingSlash = (value: string): string => value.replace(/\/$/u, "");

export interface LoadOptions {
  /**
   * Fail instead of substituting placeholders for the required identity keys.
   * Defaults to {@link STRICT_ENV} being `1`: every path that reaches
   * Cloudflare (deploy, remote migrations, a release build of the CLI) sets it,
   * so none of them can ship a placeholder, while install / test / dev on a
   * fresh clone keep working without any identity configured.
   */
  readonly strict?: boolean;
}

/** Set to `1` to refuse placeholders wherever the config is loaded. */
const STRICT_ENV = "BU_DEPLOY_STRICT";

const strictFromEnv = (): boolean => process.env[STRICT_ENV] === "1";

export const loadDeployConfig = (options: LoadOptions = {}): DeployConfig => {
  const values = loadDeployValues();
  if (options.strict ?? strictFromEnv()) {
    assertRequired(values);
  }
  const read = (key: DeployKey): string => values[key] ?? defaultOf(key);
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
    deliveryAnalyticsDataset: read("BU_DELIVERY_ANALYTICS_DATASET"),
    desktopAnalyticsDataset: read("BU_DESKTOP_ANALYTICS_DATASET"),
    emailSender,
    // One contact address by default: an instance that sets no separate legal
    // address is reachable at the one it already sends mail from.
    legalEmail: legalEmail.length > 0 ? legalEmail : emailSender,
    superadminEmails: read("BU_SUPERADMIN_EMAILS"),
    orgCreation: parseOrgCreation(read("BU_ORG_CREATION")),
    githubClientId: read("BU_GITHUB_CLIENT_ID"),
    googleClientId: read("BU_GOOGLE_CLIENT_ID"),
    cliReleaseRepo: read("BU_CLI_RELEASE_REPO"),
  };
};

/** The deployment's endpoints as the CLI binary bakes them in. */
export interface CliServiceDefaults {
  readonly baseUrl: string;
  readonly webUrl: string;
  readonly assetCdnUrl: string;
  /** GitHub `owner/repo` whose Releases carry the CLI binaries. */
  readonly releaseRepo: string;
}

/**
 * Imported by the CLI as a Bun macro (`with { type: "macro" }`), so `bun build`
 * inlines the result into the binary and the published executable never reads
 * `.env.deploy` or the environment for these. Unbundled runs (vitest, `bun
 * src/index.ts`) call it at runtime instead, which resolves the same values.
 */
export const cliServiceDefaults = (): CliServiceDefaults => {
  try {
    const config = loadDeployConfig();
    return {
      baseUrl: config.appUrl,
      webUrl: config.appUrl,
      assetCdnUrl: config.assetCdnUrl,
      releaseRepo: config.cliReleaseRepo,
    };
  } catch (error) {
    // Bun cannot carry a thrown Error out of a macro — the build only reports
    // "cannot coerce Exception" — so say what is missing before failing it.
    // eslint-disable-next-line no-console -- build-time diagnostic: stderr is the only channel out of a macro
    console.error(error instanceof Error ? error.message : String(error));
    // eslint-disable-next-line functional/no-throw-statements -- rethrow so the build fails
    throw error;
  }
};

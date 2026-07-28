import { execSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  generateIdentity,
  sealIdentity,
  unwrapVaultKey,
  wrapVaultKey,
} from "@better-update/credentials-crypto";
import { fromBase64, toBase64 } from "@better-update/encoding";

import {
  seedServerE2ESql,
  serverE2EBaseUrl,
} from "../../../server/tests/helpers/e2e-harness-client";
import { serializeRobotEnv } from "../../src/lib/robot-env";

const CLI_DIR = path.resolve(import.meta.dirname, "../..");

/** Fixture module whose exported constant is rendered by the fixture's `App.js`. */
const BUNDLE_MARKER_FILE = "bundle-marker.js";

/**
 * Env overlay that makes the CLI authenticate with the on-disk session token
 * (what `better-update login` writes) instead of the robot bearer: `AuthStore`
 * prefers `BETTER_UPDATE_ROBOT` whenever it is non-empty, so blanking it is the
 * switch. See {@link SetupCliE2EOptions.cliAuth} for when that is the right
 * principal.
 */
const USER_AUTH_ENV: Readonly<Record<string, string>> = { BETTER_UPDATE_ROBOT: "" };

export interface SetupCliE2EOptions {
  /** Use an existing directory as the CLI project root instead of creating a temp dir. */
  readonly projectDir?: string;
  /** Custom app.json template. ScopeKey and project name are derived from expo.owner/slug/name. */
  readonly appJsonTemplate?: Record<string, unknown>;
  /**
   * Write the Expo config as a CommonJS dynamic `app.config.js` instead of a static `app.json`.
   * The template is exported as the function return value (with `expo` unwrapped to match @expo/config conventions).
   * Use this to verify the CLI works against dynamic Expo configs.
   */
  readonly useDynamicConfig?: boolean;
  /**
   * Skip writing any Expo config (no app.json / app.config.js / package.json).
   * Use to exercise build-system-neutral (non-Expo) projects that link via the
   * `BETTER_UPDATE_PROJECT_ID` env var or an `eas.json` projectId instead of
   * an Expo config. The server project's name/slug are still derived from
   * `appJsonTemplate.expo` for setup, but nothing is written to the project dir.
   */
  readonly noExpoConfig?: boolean;
  /**
   * Unique sign-up email for this test file. Required because the e2e suite shares
   * a single worker + D1 across all files, and `users.email` is globally unique.
   */
  readonly userEmail: string;
  /**
   * Unique organization slug for this test file. Required for the same reason as
   * `userEmail` — `organizations.slug` is globally unique.
   */
  readonly orgSlug: string;
  /**
   * Which principal the CLI runs as by default.
   *
   * `"robot"` (default) is the CI shape: a PROJECT-scoped robot account holding
   * maintainer on this file's project. Robots are one project + one project role
   * by design (GITLAB-RBAC-SPEC §1b), so they can never satisfy the org-admin
   * ORG_RULES — webhooks, audit logs, vault administration — nor the v2 binding
   * gate for org resources with no project binding (a team-less device).
   *
   * `"user"` runs as the org OWNER's session token, exactly what
   * `better-update login` leaves in `~/.better-update/auth.json`. Use it for
   * files that exercise org administration; per-call, merge
   * {@link CliE2EContext.userAuthEnv} into `runCliWithEnv` instead.
   */
  readonly cliAuth?: "robot" | "user";
}

/**
 * A commitTime guaranteed to be NEWER than any update published during a test
 * run. The server's clock-skew guard (the `publishCreatedAt` invariant — DB
 * `created_at` is stamped = the served commitTime) rejects a rollback/republish
 * whose commitTime is not newer than the latest published update on the
 * branch/platform/runtimeVersion: the device selects updates by commitTime, so
 * an older one would never apply. Publishes in a flow are stamped at the current
 * wall clock, so a fixed future literal silently goes stale once real time
 * passes it (which is exactly how the rollback/signed-promote e2e tests broke).
 * Derive the value from `Date.now()` instead. Pass `offsetDays` to order several
 * values relative to each other (e.g. a source < its replacement).
 */
export const futureCommitTime = (offsetDays = 1): string =>
  new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString();

const defaultAppJsonTemplate = {
  expo: {
    name: "CLI E2E App",
    slug: "cli-e2e-app",
    owner: "cli-e2e",
    version: "1.0.0",
    runtimeVersion: "1.0.0",
    ios: {
      bundleIdentifier: "com.example.cli",
      buildNumber: "1",
    },
    android: {
      package: "com.example.cli",
      versionCode: 1,
    },
    extra: {
      betterUpdate: {
        profiles: {
          production: {
            environment: "production",
            ios: { distribution: "ad-hoc" },
            android: { distribution: "direct", format: "apk" },
          },
        },
      },
    },
  },
};

const parseCookies = (response: Response): string => {
  const setCookie = response.headers.getSetCookie();
  return setCookie
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
};

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

const getNodeErrorCode = (error: unknown): string | undefined => {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const directCode = (error as NodeJS.ErrnoException).code;
  if (typeof directCode === "string") {
    return directCode;
  }

  const { cause } = error as Error & { readonly cause?: unknown };
  if (typeof cause !== "object" || cause === null) {
    return undefined;
  }

  const nestedCode = (cause as NodeJS.ErrnoException).code;
  return typeof nestedCode === "string" ? nestedCode : undefined;
};

const isRetryableFetchError = (error: unknown) => {
  const code = getNodeErrorCode(error);
  return code !== undefined && ["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"].includes(code);
};

export interface CliCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface CliE2EContext {
  readonly getBaseUrl: () => string;
  readonly getProjectDir: () => string;
  readonly getProjectId: () => string;
  readonly getSeededBuildId: () => string;
  readonly readAppJson: () => Record<string, unknown>;
  readonly runCli: (...args: readonly string[]) => CliCommandResult;
  /**
   * Rewrites the fixture's `bundle-marker.js` so the next `expo export` emits
   * genuinely different bytes. Server assets are content-addressed globally, and
   * every e2e file publishes the same shared fixture — without a per-file (or
   * per-publish) marker, "fresh upload" and "v1 content ≠ v2 content" are not
   * observable. The original file is restored in `afterAll`.
   *
   * Only valid for fixture-backed projects (`projectDir`); throws otherwise.
   */
  readonly stampBundleMarker: (marker: string) => void;
  /**
   * Like {@link runCli} but with extra environment variables layered on top of
   * the base CLI env. Used to drive the non-interactive credential-vault flow
   * via `BETTER_UPDATE_IDENTITY` (the CI identity path — a raw age private key,
   * no passphrase prompt).
   */
  readonly runCliWithEnv: (
    env: Record<string, string>,
    ...args: readonly string[]
  ) => CliCommandResult;
  /**
   * Env overlay that switches a single {@link runCliWithEnv} call to the org
   * owner's user session — for files that are robot-driven except for the one
   * org-administration step (e.g. bootstrapping the org vault). Whole-file
   * switching is {@link SetupCliE2EOptions.cliAuth} instead.
   */
  readonly userAuthEnv: Readonly<Record<string, string>>;
  /**
   * Bootstraps the org's credential + env vaults and grants this file's robot
   * access to both — the real two-step onboarding, driven through the CLI.
   *
   * `identity init` deliberately refuses an env-sourced key ("bootstrap from an
   * admin's own device identity, not a robot's"), so this seals a device
   * identity for the org owner first. Call it once from `beforeAll` in files
   * whose commands read or write vault-sealed data; afterwards the robot needs
   * no extra env, because `BETTER_UPDATE_ROBOT` already carries its age key.
   */
  readonly bootstrapOrgVault: () => Promise<void>;
  readonly seedSql: (sql: string) => Promise<void>;
  readonly post: (
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ) => Promise<Response>;
  readonly get: (path: string, headers?: Record<string, string>) => Promise<Response>;
  readonly getAuthorized: (path: string, headers?: Record<string, string>) => Promise<Response>;
  readonly postAuthorized: (
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ) => Promise<Response>;
  readonly patchAuthorized: (
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ) => Promise<Response>;
  readonly deleteAuthorized: (
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ) => Promise<Response>;
}

/**
 * Configures one CLI e2e test file against the shared worker started by
 * `tests/e2e/global-setup.ts`. The unique `userEmail` and `orgSlug` are
 * required: the suite shares a single D1 instance, so each file must own
 * disjoint identifiers to avoid UNIQUE constraint collisions.
 */
export const setupCliE2E = (testId: string, options: SetupCliE2EOptions): CliE2EContext => {
  const template = options.appJsonTemplate ?? defaultAppJsonTemplate;
  const expoConfig = (template as { expo?: Record<string, unknown> }).expo ?? {};
  const slugRaw = expoConfig["slug"];
  const slug = typeof slugRaw === "string" ? slugRaw : "cli-e2e-app";
  const nameRaw = expoConfig["name"];
  const projectName = `${typeof nameRaw === "string" ? nameRaw : "E2E"} Project`;
  const useExternalProjectDir = options.projectDir !== undefined;

  const state = {
    baseUrl: "",
    cookies: "",
    organizationId: "",
    projectId: "",
    robotBearer: "",
    robotEnv: "",
    robotEncryptionKeyId: "",
    robotPublicKey: "",
    projectDir: "",
    homeDir: "",
    originalAppJson: undefined as string | undefined,
    originalBundleMarker: undefined as string | undefined,
  };

  const seedFileId = testId.replaceAll(/[^a-zA-Z0-9]+/gu, "-");
  const seededBuildId = `${seedFileId}-build-1`;

  // better-auth force-validates the Origin the moment a request carries any
  // Sec-Fetch-* hint, and Node's fetch always sends `sec-fetch-mode: cors`.
  // Without an Origin these calls get 403 MISSING_OR_NULL_ORIGIN; with a
  // foreign one, 403 INVALID_ORIGIN. The worker's own origin is better-auth's
  // baseURL for this suite (`startServerE2EStack` defaults `webUrl` to it), so
  // that is the trusted value to send.
  const withOrigin = (headers?: Record<string, string>): Record<string, string> => ({
    origin: state.baseUrl,
    ...headers,
  });

  const post = async (requestPath: string, body: unknown, headers?: Record<string, string>) =>
    requestWithRetry(async () =>
      fetch(`${state.baseUrl}${requestPath}`, {
        method: "POST",
        headers: withOrigin({ "content-type": "application/json", ...headers }),
        body: JSON.stringify(body),
      }),
    );

  const get = async (requestPath: string, headers?: Record<string, string>) =>
    requestWithRetry(async () =>
      fetch(`${state.baseUrl}${requestPath}`, { headers: withOrigin(headers) }),
    );

  const patch = async (requestPath: string, body: unknown, headers?: Record<string, string>) =>
    requestWithRetry(async () =>
      fetch(`${state.baseUrl}${requestPath}`, {
        method: "PATCH",
        headers: withOrigin({ "content-type": "application/json", ...headers }),
        body: JSON.stringify(body),
      }),
    );

  const del = async (requestPath: string, body: unknown, headers?: Record<string, string>) =>
    requestWithRetry(async () =>
      fetch(`${state.baseUrl}${requestPath}`, {
        method: "DELETE",
        headers: withOrigin({ "content-type": "application/json", ...headers }),
        body: JSON.stringify(body),
      }),
    );

  const seedSql = seedServerE2ESql;

  const requestWithRetry = async (run: () => Promise<Response>): Promise<Response> => {
    const maxAttempts = 4;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        if (!isRetryableFetchError(error) || attempt === maxAttempts) {
          throw error;
        }

        await sleep(attempt * 100);
      }
    }

    throw new Error("requestWithRetry exhausted unexpectedly");
  };

  // Move legacy `expo.extra.betterUpdate.profiles` (the pre-config shape) into a
  // sibling eas.json `build` section. Strip the legacy field from the
  // app config so eas.json is the only build-profile source.
  const splitTemplateAndBuildProfiles = (
    rawTemplate: Record<string, unknown>,
  ): {
    readonly cleanedTemplate: Record<string, unknown>;
    readonly buildProfiles: Record<string, unknown> | null;
  } => {
    const cloned = structuredClone(rawTemplate);
    const expo = cloned["expo"] as Record<string, unknown> | undefined;
    const extra = expo?.["extra"] as Record<string, unknown> | undefined;
    const betterUpdate = extra?.["betterUpdate"] as Record<string, unknown> | undefined;
    const profiles = betterUpdate?.["profiles"] as Record<string, unknown> | undefined;
    if (!profiles) {
      return { cleanedTemplate: cloned, buildProfiles: null };
    }
    delete betterUpdate?.["profiles"];
    return { cleanedTemplate: cloned, buildProfiles: profiles };
  };

  const writeBuildProfilesIfNeeded = (buildProfiles: Record<string, unknown> | null) => {
    if (!buildProfiles) {
      return;
    }
    const configPath = path.join(state.projectDir, "eas.json");
    const existing = existsSync(configPath)
      ? (JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>)
      : {};
    writeFileSync(
      configPath,
      `${JSON.stringify({ ...existing, build: buildProfiles }, null, 2)}\n`,
    );
  };

  const writeExpoConfig = () => {
    // @expo/config requires a package.json to resolve the project root.
    // Don't clobber an existing package.json (e.g. the build-e2e fixture has its own).
    const pkgJsonPath = path.join(state.projectDir, "package.json");
    if (!existsSync(pkgJsonPath)) {
      writeFileSync(pkgJsonPath, `${JSON.stringify({ name: slug, version: "1.0.0" }, null, 2)}\n`);
    }
    const { cleanedTemplate, buildProfiles } = splitTemplateAndBuildProfiles(template);
    writeBuildProfilesIfNeeded(buildProfiles);
    if (options.useDynamicConfig) {
      // Drop any pre-existing app.json so the dynamic config is unambiguously
      // The source of truth for @expo/config (avoids static-base shadowing).
      const appJsonPath = path.join(state.projectDir, "app.json");
      if (existsSync(appJsonPath)) {
        unlinkSync(appJsonPath);
      }
      const expo = (cleanedTemplate as { expo?: Record<string, unknown> }).expo ?? {};
      // Function-form export so process.env reads (e.g. BETTER_UPDATE_E2E_PROJECT_ID
      // For projectId injection) are evaluated on each readExpoConfig call rather
      // Than frozen at module-load time.
      writeFileSync(
        path.join(state.projectDir, "app.config.js"),
        [
          `module.exports = () => {`,
          `  const config = ${JSON.stringify(expo, null, 2)};`,
          `  if (process.env.BETTER_UPDATE_E2E_PROJECT_ID) {`,
          `    config.extra = {`,
          `      ...(config.extra ?? {}),`,
          `      betterUpdate: {`,
          `        ...(config.extra && config.extra.betterUpdate ? config.extra.betterUpdate : {}),`,
          `        projectId: process.env.BETTER_UPDATE_E2E_PROJECT_ID,`,
          `      },`,
          `    };`,
          `  }`,
          `  return config;`,
          `};`,
          ``,
        ].join("\n"),
      );
      return;
    }
    writeFileSync(
      path.join(state.projectDir, "app.json"),
      `${JSON.stringify(cleanedTemplate, null, 2)}\n`,
    );
  };

  const runCliWithEnv = (
    extraEnv: Record<string, string>,
    ...args: readonly string[]
  ): CliCommandResult => {
    // Use the pre-built dist binary to skip per-invocation TypeScript compile.
    // Built once by `pretest:e2e` (`tsdown`). ~5x faster than running src/index.ts directly.
    const result = spawnSync("bun", [path.resolve(CLI_DIR, "dist/index.mjs"), ...args], {
      cwd: state.projectDir,
      env: {
        ...process.env,
        HOME: state.homeDir,
        BETTER_UPDATE_URL: state.baseUrl,
        BETTER_UPDATE_ROBOT: state.robotEnv,
        BETTER_UPDATE_DISABLE_UPDATE_NOTIFIER: "1",
        // CI=1 + no TTY makes the CLI's prompt layer throw `InteractiveProhibitedError`
        // instead of blocking on stdin. Without this, `ensureRepoClean` in `update
        // publish` / `build` would hang forever on the dirty fixture working tree
        // because clack `confirm()` waits for a key that never arrives via spawnSync.
        CI: "1",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
        ...(options.cliAuth === "user" ? USER_AUTH_ENV : {}),
        ...extraEnv,
      },
      encoding: "utf8",
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.status ?? 1,
    };
  };

  const runCli = (...args: readonly string[]): CliCommandResult => runCliWithEnv({}, ...args);

  // A bare `expect(exitCode).toBe(0)` on a setup command reports "expected 2 to
  // be 0" and hides the CLI's own message, which is the only useful part when a
  // whole file's beforeAll dies. Throw with it instead.
  const assertCliSucceeded = (result: CliCommandResult, label: string) => {
    if (result.exitCode !== 0) {
      throw new Error(`${label} failed (exit ${String(result.exitCode)}): ${result.stderr.trim()}`);
    }
  };

  const bootstrapOrgVault = async () => {
    // Seal an identity for the org owner the way `credentials identity create`
    // would. Done here rather than through the CLI because `create` prompts for
    // a new passphrase and the e2e CLI runs non-interactive (CI=1).
    const adminIdentity = await generateIdentity();
    const sealed = await sealIdentity({
      privateKey: adminIdentity.privateKey,
      passphrase: "e2e-device-passphrase",
    });
    writeFileSync(
      path.join(state.homeDir, ".better-update", "identity.json"),
      `${JSON.stringify(sealed, null, 2)}\n`,
    );

    // Bootstrapping only wraps the vault key TO the device recipient, so it
    // needs the public half alone — no passphrase prompt is reached.
    const init = runCliWithEnv(
      USER_AUTH_ENV,
      "credentials",
      "identity",
      "init",
      "--label",
      "E2E Admin Device",
    );
    assertCliSucceeded(init, "credentials identity init");

    // Granting DOES unlock, which would prompt for the device passphrase — but
    // an env-sourced key unlocks non-interactively, and this env key is the very
    // recipient the vault was just wrapped to. `--yes` skips the out-of-band
    // fingerprint confirmation, which is the other interactive step.
    const adminEnv = { ...USER_AUTH_ENV, BETTER_UPDATE_IDENTITY: adminIdentity.privateKey };
    const grant = runCliWithEnv(
      adminEnv,
      "credentials",
      "access",
      "grant",
      state.robotEncryptionKeyId,
      "--yes",
    );
    assertCliSucceeded(grant, "credentials access grant");

    // Orgs are born forked, so the env vault is a SECOND, independent key the
    // credentials grant above does not cover. `credentials robot grant-env`
    // would do it, but it unlocks the env vault through the ADMIN's wrap, which
    // is keyed by `(recipientKind, keyId)` — and a key handed over in the env
    // resolves as `machine`, while this one is registered as a `device`. The
    // only CLI route to a device's env wrap is the passphrase prompt, which
    // cannot run under CI=1. So re-wrap the env key here, exactly as
    // `grantEnvRecipient` does, with the same two API calls.
    await grantRobotEnvVaultAccess(adminIdentity);
  };

  const grantRobotEnvVaultAccess = async (adminIdentity: {
    readonly publicKey: string;
    readonly privateKey: string;
  }) => {
    const keysResponse = await get("/api/encryption-keys", { cookie: state.cookies });
    expect(keysResponse.status).toBe(200);
    const { items } = (await keysResponse.json()) as {
      items: { id: string; publicKey: string }[];
    };
    const adminKey = items.find((key) => key.publicKey === adminIdentity.publicKey);
    expect(adminKey).toBeDefined();

    const wrapResponse = await get(`/api/env-vault/wraps/device/${adminKey!.id}`, {
      cookie: state.cookies,
    });
    expect(wrapResponse.status).toBe(200);
    const adminWrap = (await wrapResponse.json()) as {
      wrappedKey: string;
      envVaultVersion: number;
    };

    const envVaultKey = await unwrapVaultKey({
      wrapped: fromBase64(adminWrap.wrappedKey),
      privateKey: adminIdentity.privateKey,
    });
    const wrappedForRobot = await wrapVaultKey({
      vaultKey: envVaultKey,
      recipient: state.robotPublicKey,
    });

    const addResponse = await post(
      "/api/env-vault/wraps",
      {
        envVaultVersion: adminWrap.envVaultVersion,
        wrap: {
          recipientKind: "machine",
          recipientId: state.robotEncryptionKeyId,
          wrappedKey: toBase64(wrappedForRobot),
        },
      },
      { cookie: state.cookies },
    );
    expect(addResponse.status).toBe(201);
  };

  const stampBundleMarker = (marker: string) => {
    const markerPath = path.join(state.projectDir, BUNDLE_MARKER_FILE);
    if (!existsSync(markerPath)) {
      throw new Error(
        `stampBundleMarker requires a fixture project shipping ${BUNDLE_MARKER_FILE} (looked in ${state.projectDir}).`,
      );
    }
    state.originalBundleMarker ??= readFileSync(markerPath, "utf8");
    writeFileSync(markerPath, `export const BUNDLE_MARKER = ${JSON.stringify(marker)};\n`);
  };

  beforeAll(async () => {
    state.baseUrl = serverE2EBaseUrl();
    state.homeDir = mkdtempSync(path.join(os.tmpdir(), "better-update-cli-home-"));

    if (useExternalProjectDir) {
      state.projectDir = options.projectDir!;
      const appJsonPath = path.join(state.projectDir, "app.json");
      if (existsSync(appJsonPath)) {
        state.originalAppJson = readFileSync(appJsonPath, "utf8");
      }
      // Fixture dirs live outside the workspace glob so a root `bun install`
      // does not touch them. Install per-fixture deps on demand so `expo
      // export` can resolve react-native + the bundler config.
      if (!existsSync(path.join(state.projectDir, "node_modules"))) {
        execSync("bun install --frozen-lockfile", {
          cwd: state.projectDir,
          stdio: "pipe",
        });
      }
    } else {
      state.projectDir = mkdtempSync(path.join(os.tmpdir(), "better-update-cli-project-"));
    }
    if (!options.noExpoConfig) {
      writeExpoConfig();
    }

    const signUpResponse = await post("/api/auth/sign-up/email", {
      name: "CLI E2E User",
      email: options.userEmail,
      password: "SecureP@ss123",
    });
    expect(signUpResponse.status).toBe(200);
    state.cookies = parseCookies(signUpResponse);

    // better-auth's `bearer` plugin returns the raw session token here; the
    // server accepts it as `Authorization: Bearer <token>` and resolves a real
    // user session (auth/middleware `resolveFromBearer`). Persist it the way
    // `better-update login` does so `cliAuth: "user"` / `userAuthEnv` calls run
    // as this org's owner. Written before `set-active`, but the token addresses
    // the session ROW — the active organization set below applies to it too.
    const sessionToken = signUpResponse.headers.get("set-auth-token");
    expect(sessionToken).toStrictEqual(expect.any(String));
    const authDir = path.join(state.homeDir, ".better-update");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(
      path.join(authDir, "auth.json"),
      `${JSON.stringify({ token: sessionToken }, null, 2)}\n`,
    );

    const createOrgResponse = await post(
      "/api/auth/organization/create",
      { name: `${options.orgSlug} Org`, slug: options.orgSlug },
      { cookie: state.cookies },
    );
    expect(createOrgResponse.status).toBe(200);
    const createOrgBody = await createOrgResponse.json();
    state.organizationId = createOrgBody.id;
    state.cookies = parseCookies(createOrgResponse) || state.cookies;

    const setActiveResponse = await post(
      "/api/auth/organization/set-active",
      { organizationId: state.organizationId },
      { cookie: state.cookies },
    );
    expect(setActiveResponse.status).toBe(200);
    state.cookies = parseCookies(setActiveResponse) || state.cookies;

    const createProjectResponse = await post(
      "/api/projects",
      { name: projectName, slug },
      { cookie: state.cookies },
    );
    expect(createProjectResponse.status).toBe(201);
    const createProjectBody = await createProjectResponse.json();
    state.projectId = createProjectBody.id;

    // A real age keypair (not a fake string): some CLI flows in this shared
    // suite exercise the credential vault, which derives the recipient from the
    // identity half via `deriveRecipient` — a malformed key would crash those
    // rather than cleanly 403.
    // Robots are project-scoped under GitLab-style RBAC v2 (GITLAB-RBAC-SPEC
    // §1b): one robot = one project + one project role, both fixed at creation.
    // Maintainer on the suite's project is the highest rank a robot can hold —
    // enough for every project-scoped CLI flow this suite exercises.
    const robotIdentity = await generateIdentity();
    const createRobotResponse = await post(
      "/api/robot-accounts",
      {
        name: `${testId}-robot`,
        publicKey: robotIdentity.publicKey,
        fingerprint: robotIdentity.fingerprint,
        projectId: state.projectId,
        role: "maintainer",
      },
      { cookie: state.cookies },
    );
    expect(createRobotResponse.status).toBe(201);
    const createRobotBody = await createRobotResponse.json();
    state.robotBearer = createRobotBody.bearerSecret;
    // The robot's age keypair is registered as a machine-kind vault recipient at
    // creation, but holds no vault wrap yet — `bootstrapOrgVault` grants it.
    state.robotEncryptionKeyId = createRobotBody.userEncryptionKeyId;
    state.robotPublicKey = robotIdentity.publicKey;
    state.robotEnv = serializeRobotEnv({
      bearer: createRobotBody.bearerSecret,
      identity: robotIdentity.privateKey,
    });

    const createBranchResponse = await post(
      "/api/branches",
      { projectId: state.projectId, name: "main" },
      { cookie: state.cookies },
    );
    expect(createBranchResponse.status).toBe(201);

    // Env vars are end-to-end encrypted now, so they can't be seeded via a plain
    // API POST (the value must be sealed client-side under the org vault key).
    // The env-var e2e flow bootstraps a vault and exercises set/pull itself.

    await seedSql(`
INSERT INTO "builds" (
  "id", "project_id", "platform", "profile", "distribution", "runtime_version",
  "app_version", "build_number", "bundle_id", "git_ref", "git_commit",
  "message", "metadata_json", "created_at"
)
VALUES (
  ${sqlString(seededBuildId)},
  ${sqlString(state.projectId)},
  'ios',
  'production',
  'ad-hoc',
  '1.0.0',
  '1.0.0',
  '1',
  'com.example.cli',
  'main',
  'abcdef1',
  'CLI seeded build',
  '{}',
  '2024-04-01T00:00:00Z'
);

INSERT INTO "build_artifacts" (
  "build_id", "r2_key", "format", "content_type", "byte_size", "sha256", "created_at"
)
VALUES (
  ${sqlString(seededBuildId)},
  'builds/${state.organizationId}/${state.projectId}/${seededBuildId}.ipa',
  'ipa',
  'application/octet-stream',
  1024,
  'cli-build-sha',
  '2024-04-01T00:00:00Z'
);
`);
  });

  afterAll(() => {
    if (useExternalProjectDir) {
      if (state.originalAppJson !== undefined) {
        writeFileSync(path.join(state.projectDir, "app.json"), state.originalAppJson);
      }
      // Fixture dirs are shared across e2e files (and tracked in git), so a
      // stamped marker must not leak into the next file or the working tree.
      if (state.originalBundleMarker !== undefined) {
        writeFileSync(path.join(state.projectDir, BUNDLE_MARKER_FILE), state.originalBundleMarker);
      }
    } else {
      rmSync(state.projectDir, { recursive: true, force: true });
    }
    rmSync(state.homeDir, { recursive: true, force: true });
  });

  return {
    getBaseUrl: () => state.baseUrl,
    getProjectDir: () => state.projectDir,
    getProjectId: () => state.projectId,
    getSeededBuildId: () => seededBuildId,
    readAppJson: () =>
      JSON.parse(readFileSync(path.join(state.projectDir, "app.json"), "utf8")) as Record<
        string,
        unknown
      >,
    runCli,
    runCliWithEnv,
    userAuthEnv: USER_AUTH_ENV,
    bootstrapOrgVault,
    stampBundleMarker,
    seedSql,
    post,
    get,
    getAuthorized: async (requestPath, headers) =>
      get(requestPath, { authorization: `Bearer ${state.robotBearer}`, ...headers }),
    postAuthorized: async (requestPath, body, headers) =>
      post(requestPath, body, { authorization: `Bearer ${state.robotBearer}`, ...headers }),
    patchAuthorized: async (requestPath, body, headers) =>
      patch(requestPath, body, { authorization: `Bearer ${state.robotBearer}`, ...headers }),
    deleteAuthorized: async (requestPath, body, headers) =>
      del(requestPath, body, { authorization: `Bearer ${state.robotBearer}`, ...headers }),
  };
};

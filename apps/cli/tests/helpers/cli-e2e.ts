import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { applyProcessEnv, createServerE2EEnvironment } from "../../../server/tests/helpers/e2e-env";

import type { unstable_startWorker } from "../../../server/node_modules/wrangler";

const CLI_DIR = path.resolve(import.meta.dirname, "../..");
const SERVER_DIR = path.resolve(import.meta.dirname, "../../../server");

const pickFreePort = async () =>
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
}

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
  readonly readAppJson: () => Record<string, unknown>;
  readonly runCli: (...args: readonly string[]) => CliCommandResult;
  readonly seedSql: (sql: string) => void;
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

export const setupCliE2E = (persistDir: string, options?: SetupCliE2EOptions): CliE2EContext => {
  const template = options?.appJsonTemplate ?? defaultAppJsonTemplate;
  const expoConfig = (template as { expo?: Record<string, unknown> }).expo ?? {};
  const slugRaw = expoConfig["slug"];
  const slug = typeof slugRaw === "string" ? slugRaw : "cli-e2e-app";
  const nameRaw = expoConfig["name"];
  const projectName = `${typeof nameRaw === "string" ? nameRaw : "E2E"} Project`;
  const useExternalProjectDir = options?.projectDir !== undefined;

  const state = {
    worker: null as Awaited<ReturnType<typeof unstable_startWorker>> | null,
    baseUrl: "",
    cookies: "",
    organizationId: "",
    projectId: "",
    apiKey: "",
    projectDir: "",
    homeDir: "",
    restoreProcessEnv: undefined as (() => void) | undefined,
    originalAppJson: undefined as string | undefined,
  };

  const persistPath = path.resolve(SERVER_DIR, persistDir);
  const persistArg = path.relative(SERVER_DIR, persistPath) || ".";
  const seedFileId = persistDir.replaceAll(/[^a-zA-Z0-9]+/gu, "-");
  const seedFile = path.resolve(SERVER_DIR, `.wrangler/seed-${seedFileId}.sql`);

  const post = async (requestPath: string, body: unknown, headers?: Record<string, string>) =>
    requestWithRetry(async () =>
      fetch(`${state.baseUrl}${requestPath}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );

  const get = async (requestPath: string, headers?: Record<string, string>) =>
    requestWithRetry(async () =>
      fetch(`${state.baseUrl}${requestPath}`, headers ? { headers } : {}),
    );

  const patch = async (requestPath: string, body: unknown, headers?: Record<string, string>) =>
    requestWithRetry(async () =>
      fetch(`${state.baseUrl}${requestPath}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );

  const del = async (requestPath: string, body: unknown, headers?: Record<string, string>) =>
    requestWithRetry(async () =>
      fetch(`${state.baseUrl}${requestPath}`, {
        method: "DELETE",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );

  const seedSql = (sql: string) => {
    writeFileSync(seedFile, sql);
    try {
      execSync(
        `bunx wrangler d1 execute DB --local --persist-to ${persistArg} --file ${seedFile}`,
        {
          cwd: SERVER_DIR,
          stdio: "pipe",
        },
      );
    } finally {
      rmSync(seedFile, { force: true });
    }
  };

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

  const writeExpoConfig = () => {
    // @expo/config requires a package.json to resolve the project root.
    // Don't clobber an existing package.json (e.g. the build-e2e fixture has its own).
    const pkgJsonPath = path.join(state.projectDir, "package.json");
    if (!existsSync(pkgJsonPath)) {
      writeFileSync(pkgJsonPath, `${JSON.stringify({ name: slug, version: "1.0.0" }, null, 2)}\n`);
    }
    if (options?.useDynamicConfig) {
      // Drop any pre-existing app.json so the dynamic config is unambiguously
      // The source of truth for @expo/config (avoids static-base shadowing).
      const appJsonPath = path.join(state.projectDir, "app.json");
      if (existsSync(appJsonPath)) {
        unlinkSync(appJsonPath);
      }
      const expo = (template as { expo?: Record<string, unknown> }).expo ?? {};
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
      `${JSON.stringify(template, null, 2)}\n`,
    );
  };

  const runCli = (...args: readonly string[]): CliCommandResult => {
    const result = spawnSync("bun", [path.resolve(CLI_DIR, "src/index.ts"), ...args], {
      cwd: state.projectDir,
      env: {
        ...process.env,
        HOME: state.homeDir,
        BETTER_UPDATE_URL: state.baseUrl,
        BETTER_UPDATE_TOKEN: state.apiKey,
        BETTER_UPDATE_DISABLE_UPDATE_NOTIFIER: "1",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      encoding: "utf8",
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.status ?? 1,
    };
  };

  beforeAll(async () => {
    rmSync(persistPath, { recursive: true, force: true });
    const port = await pickFreePort();
    const publicApiUrl = `http://127.0.0.1:${String(port)}`;
    const e2eEnv = createServerE2EEnvironment({
      projectRoot: SERVER_DIR,
      publicApiUrl,
    });
    state.restoreProcessEnv = applyProcessEnv(e2eEnv.processOverrides);

    execSync(`bunx wrangler d1 migrations apply DB --local --persist-to ${persistArg}`, {
      cwd: SERVER_DIR,
      env: e2eEnv.wranglerEnv,
      stdio: "pipe",
    });

    const originalCwd = process.cwd();
    process.chdir(SERVER_DIR);
    try {
      const { unstable_startWorker } = await import("../../../server/node_modules/wrangler");
      state.worker = await unstable_startWorker({
        config: path.resolve(SERVER_DIR, "wrangler.jsonc"),
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

    const url = await state.worker.url;
    state.baseUrl = url.href.replace(/\/$/, "");

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
    writeExpoConfig();

    const signUpResponse = await post("/api/auth/sign-up/email", {
      name: "CLI E2E User",
      email: "cli-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signUpResponse.status).toBe(200);
    state.cookies = parseCookies(signUpResponse);

    const createOrgResponse = await post(
      "/api/auth/organization/create",
      { name: "CLI Org", slug: "cli-org" },
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

    const createKeyResponse = await post(
      "/api/auth/api-key/create",
      { name: "cli-e2e-key", organizationId: state.organizationId },
      { cookie: state.cookies },
    );
    expect(createKeyResponse.status).toBe(200);
    const createKeyBody = await createKeyResponse.json();
    state.apiKey = createKeyBody.key;

    const createBranchResponse = await post(
      "/api/branches",
      { projectId: state.projectId, name: "main" },
      { cookie: state.cookies },
    );
    expect(createBranchResponse.status).toBe(201);

    const createEnvVarResponse = await post(
      "/api/env-vars",
      {
        projectId: state.projectId,
        environment: "production",
        key: "APP_SECRET",
        value: "super-secret",
        visibility: "secret",
      },
      { cookie: state.cookies },
    );
    expect(createEnvVarResponse.status).toBe(201);

    seedSql(`
INSERT INTO "builds" (
  "id", "project_id", "platform", "profile", "distribution", "runtime_version",
  "app_version", "build_number", "bundle_id", "git_ref", "git_commit",
  "message", "metadata_json", "created_at"
)
VALUES (
  'cli-build-1',
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
  'cli-build-1',
  'builds/${state.organizationId}/${state.projectId}/cli-build-1.ipa',
  'ipa',
  'application/octet-stream',
  1024,
  'cli-build-sha',
  '2024-04-01T00:00:00Z'
);
`);
  });

  afterAll(async () => {
    await state.worker?.dispose();
    state.restoreProcessEnv?.();
    rmSync(persistPath, { recursive: true, force: true });
    if (useExternalProjectDir) {
      if (state.originalAppJson !== undefined) {
        writeFileSync(path.join(state.projectDir, "app.json"), state.originalAppJson);
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
    readAppJson: () =>
      JSON.parse(readFileSync(path.join(state.projectDir, "app.json"), "utf8")) as Record<
        string,
        unknown
      >,
    runCli,
    seedSql,
    post,
    get,
    getAuthorized: async (requestPath, headers) =>
      get(requestPath, { authorization: `Bearer ${state.apiKey}`, ...headers }),
    postAuthorized: async (requestPath, body, headers) =>
      post(requestPath, body, { authorization: `Bearer ${state.apiKey}`, ...headers }),
    patchAuthorized: async (requestPath, body, headers) =>
      patch(requestPath, body, { authorization: `Bearer ${state.apiKey}`, ...headers }),
    deleteAuthorized: async (requestPath, body, headers) =>
      del(requestPath, body, { authorization: `Bearer ${state.apiKey}`, ...headers }),
  };
};

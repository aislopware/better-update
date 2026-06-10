import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import process from "node:process";

import { CommandExecutor } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import { ArtifactNotFoundError, BuildProfileError } from "../lib/exit-codes";
import { makeInteractiveModeLayer } from "../lib/interactive-mode";
import { OutputModeLive } from "../lib/output-mode";
import { failureError } from "../lib/test-utils";
import { ApiClientService } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { IdentityStore } from "../services/identity-store";
import { PresignedUploadClient } from "../services/presigned-upload";
import { runUploadWorkflow } from "./upload-workflow";

import type { ApiClient } from "../services/api-client";

// ── fixtures ──────────────────────────────────────────────────────

const baseAppJson = {
  expo: {
    name: "Upload Test App",
    slug: "upload-test-app",
    version: "1.2.3",
    runtimeVersion: "1.2.3",
    ios: {
      bundleIdentifier: "com.example.upload",
      buildNumber: "42",
    },
    android: {
      package: "com.example.upload",
      versionCode: 42,
    },
    extra: {
      betterUpdate: {
        projectId: "proj_1",
      },
    },
  },
};

const baseEasJson = {
  build: {
    production: {
      environment: "production",
      ios: { distribution: "ad-hoc" },
      android: { distribution: "direct", format: "apk" },
    },
  },
};

interface ProjectFixture {
  readonly dir: string;
  readonly artifactPath: string;
  readonly dispose: () => void;
}

const setupProject = (options: {
  readonly appJson?: Record<string, unknown>;
  readonly easJson?: Record<string, unknown>;
  readonly createArtifact?: boolean;
  readonly artifactBytes?: Buffer;
}): ProjectFixture => {
  // realpathSync mirrors expo-config.test.ts — @expo/config rejects symlinked
  // project roots on macOS (`/var/folders` is itself a symlink to `/private/var`).
  const dir = realpathSync(mkdtempSync(nodePath.join(tmpdir(), "upload-workflow-test-")));
  const appJson = options.appJson ?? baseAppJson;
  writeFileSync(nodePath.join(dir, "app.json"), JSON.stringify(appJson, null, 2));
  const buildConfig = options.easJson ?? baseEasJson;
  writeFileSync(nodePath.join(dir, "eas.json"), JSON.stringify(buildConfig, null, 2));
  // @expo/config requires a package.json in the project root.
  writeFileSync(
    nodePath.join(dir, "package.json"),
    JSON.stringify({ name: "upload-workflow-test", version: "1.0.0" }, null, 2),
  );
  const artifactPath = nodePath.join(dir, "artifact.ipa");
  if (options.createArtifact !== false) {
    writeFileSync(artifactPath, options.artifactBytes ?? Buffer.from("fake-artifact"));
  }
  return {
    dir,
    artifactPath,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
};

// ── service stubs ─────────────────────────────────────────────────

interface ApiStubOptions {
  readonly reserve?: (args: { payload: Record<string, unknown> }) => Effect.Effect<
    {
      id: string;
      uploadMode: "single";
      uploadUrl: string;
      uploadExpiresAt: string;
      uploadHeaders: Record<string, string>;
    },
    unknown
  >;
  readonly complete?: (args: {
    path: { id: string };
    payload: { sha256: string; byteSize: number };
  }) => Effect.Effect<{ id: string; artifact: unknown }, unknown>;
  readonly envVars?: readonly { key: string; value: string }[];
}

const makeApi = (opts: ApiStubOptions = {}): ApiClient =>
  ({
    builds: {
      reserve:
        opts.reserve ??
        (() =>
          Effect.succeed({
            id: "build_1",
            uploadMode: "single" as const,
            uploadUrl: "https://example.com/upload",
            uploadExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            uploadHeaders: { "content-type": "application/octet-stream" },
          })),
      complete:
        opts.complete ??
        (({ path, payload }) =>
          Effect.succeed({
            id: path.id,
            artifact: {
              r2Key: `r2/${path.id}`,
              format: "ipa",
              contentType: "application/octet-stream",
              byteSize: payload.byteSize,
              sha256: payload.sha256,
            },
          })),
    },
    "env-vars": {
      export: () => Effect.succeed({ items: opts.envVars ?? [] }),
    },
  }) as unknown as ApiClient;

const makeApiClientLayer = (api: ApiClient) =>
  Layer.succeed(ApiClientService, {
    get: Effect.succeed(api),
    exchangeOneTimeToken: () => Effect.succeed("test-session-token"),
  });

const makePresignedUploadLayer = (
  put: PresignedUploadClient["Type"]["putToPresignedUrl"] = () => Effect.void,
) => Layer.succeed(PresignedUploadClient, { putToPresignedUrl: put });

// Stub CommandExecutor returning empty stdout for every command.
// Replaces NodeContext.layer's executor so the workflow's `bunx @expo/fingerprint`
// invocation does not actually shell out (the tempdir fixture is not a real
// Expo project, so the install + fetch would hang past the test timeout).
// `readGitContext` already wraps every git command in `catchAll`, so empty
// stdout produces all-undefined fields. `runFingerprintForPlatform` JSON-parses
// the empty string and fails, which the workflow likewise swallows into
// `undefined`.
const stubCommandExecutorLayer = Layer.succeed(CommandExecutor.CommandExecutor, {
  [CommandExecutor.TypeId]: CommandExecutor.TypeId,
  string: () => Effect.succeed(""),
} as unknown as CommandExecutor.CommandExecutor);

// pullEnvVars only unlocks the vault when the project has env vars (the stub
// returns none), so these satisfy the type without ever being invoked.
const stubVaultLayer = Layer.mergeAll(
  makeInteractiveModeLayer(false),
  Layer.succeed(IdentityStore, {
    load: Effect.sync(() => null),
    save: () => Effect.void,
    clear: Effect.void,
  }),
);

const makeCliRuntimeLayer = (cwd: string) =>
  Layer.succeed(CliRuntime, {
    argv: [],
    platform: process.platform,
    cwd: Effect.succeed(cwd),
    getEnv: (name: string) => Effect.sync(() => process.env[name]),
    homeDirectory: Effect.succeed(cwd),
    userName: Effect.succeed("test"),
    commandEnvironment: () => Effect.succeed({}),
    setExitCode: () => Effect.void,
  });

// Run the workflow after process.chdir(projectDir) so @expo/config can locate
// the fixture's package.json + app.json via the project root. Restore cwd and
// clean the temp dir in a finalizer so test failures do not leak state across
// runs.
const runWorkflow = (
  project: ProjectFixture,
  api: ApiClient,
  options: Parameters<typeof runUploadWorkflow>[0],
  put?: PresignedUploadClient["Type"]["putToPresignedUrl"],
) => {
  const originalCwd = process.cwd();
  process.chdir(project.dir);
  return runUploadWorkflow(options).pipe(
    Effect.provide(
      Layer.mergeAll(
        makeApiClientLayer(api),
        makePresignedUploadLayer(put),
        makeCliRuntimeLayer(project.dir),
        NodeContext.layer,
        OutputModeLive,
        stubCommandExecutorLayer,
        stubVaultLayer,
      ),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        process.chdir(originalCwd);
        project.dispose();
      }),
    ),
  );
};

// ── tests ─────────────────────────────────────────────────────────

describe(runUploadWorkflow, () => {
  it.effect("fails with ArtifactNotFoundError when the artifact is missing", () =>
    Effect.gen(function* () {
      const project = setupProject({ createArtifact: false });
      const exit = yield* runWorkflow(project, makeApi(), {
        platform: "ios",
        profileName: "production",
        artifactPath: project.artifactPath,
        message: undefined,
      }).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(failureError(exit)).toBeInstanceOf(ArtifactNotFoundError);
      }
    }),
  );

  it.effect("fails with BuildProfileError when the profile has no ios section", () =>
    Effect.gen(function* () {
      const project = setupProject({
        easJson: {
          build: {
            production: {
              environment: "production",
              android: { distribution: "direct", format: "apk" },
            },
          },
        },
      });

      const exit = yield* runWorkflow(project, makeApi(), {
        platform: "ios",
        profileName: "production",
        artifactPath: project.artifactPath,
        message: undefined,
      }).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = failureError(exit);
        expect(err).toBeInstanceOf(BuildProfileError);
        expect((err as BuildProfileError).message).toContain("has no ios section");
      }
    }),
  );

  it.effect("fails with BuildProfileError when expo.ios.bundleIdentifier is missing", () =>
    Effect.gen(function* () {
      const project = setupProject({
        appJson: {
          expo: {
            ...baseAppJson.expo,
            ios: {},
          },
        },
      });

      const exit = yield* runWorkflow(project, makeApi(), {
        platform: "ios",
        profileName: "production",
        artifactPath: project.artifactPath,
        message: undefined,
      }).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = failureError(exit);
        expect(err).toBeInstanceOf(BuildProfileError);
        expect((err as BuildProfileError).message).toContain("bundleIdentifier");
      }
    }),
  );

  it.effect("happy path ios: reserves, uploads, completes with expected payload", () =>
    Effect.gen(function* () {
      const project = setupProject({ artifactBytes: Buffer.from("hello world") });

      let reservePayload: Record<string, unknown> | undefined;
      let completeArgs:
        | { path: { id: string }; payload: { sha256: string; byteSize: number } }
        | undefined;
      let putFilePath: string | undefined;

      const api = makeApi({
        reserve: ({ payload }) => {
          reservePayload = payload;
          return Effect.succeed({
            id: "build_happy",
            uploadMode: "single" as const,
            uploadUrl: "https://example.com/upload",
            uploadExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            uploadHeaders: { "content-type": "application/octet-stream" },
          });
        },
        complete: (args) => {
          completeArgs = args;
          return Effect.succeed({
            id: args.path.id,
            artifact: {
              r2Key: `r2/${args.path.id}`,
              format: "ipa",
              contentType: "application/octet-stream",
              byteSize: args.payload.byteSize,
              sha256: args.payload.sha256,
            },
          });
        },
      });

      yield* runWorkflow(
        project,
        api,
        {
          platform: "ios",
          profileName: "production",
          artifactPath: project.artifactPath,
          message: "pre-built upload",
        },
        ({ filePath }) => {
          putFilePath = filePath;
          return Effect.void;
        },
      );

      expect(reservePayload).toBeDefined();
      expect(reservePayload?.["projectId"]).toBe("proj_1");
      expect(reservePayload?.["platform"]).toBe("ios");
      expect(reservePayload?.["distribution"]).toBe("ad-hoc");
      expect(reservePayload?.["artifactFormat"]).toBe("ipa");
      expect(reservePayload?.["profile"]).toBe("production");
      expect(reservePayload?.["runtimeVersion"]).toBe("1.2.3");
      expect(reservePayload?.["bundleId"]).toBe("com.example.upload");
      expect(reservePayload?.["appVersion"]).toBe("1.2.3");
      expect(reservePayload?.["buildNumber"]).toBe("42");
      expect(reservePayload?.["message"]).toBe("pre-built upload");
      expect(reservePayload?.["byteSize"]).toBe(11);
      const sha256 = reservePayload?.["sha256"];
      expect(sha256).toMatch(/^[a-f0-9]{64}$/);

      expect(completeArgs?.path.id).toBe("build_happy");
      expect(completeArgs?.payload.byteSize).toBe(11);
      expect(completeArgs?.payload.sha256).toBe(sha256);

      expect(putFilePath).toBe(project.artifactPath);
    }),
  );
});

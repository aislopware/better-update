import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import { ArtifactNotFoundError, BuildProfileError } from "../lib/exit-codes";
import { failureError } from "../lib/test-utils";
import { ApiClientService } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
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

interface ProjectFixture {
  readonly dir: string;
  readonly artifactPath: string;
  readonly dispose: () => void;
}

const setupProject = (options: {
  readonly appJson?: Record<string, unknown>;
  readonly createArtifact?: boolean;
  readonly artifactBytes?: Buffer;
}): ProjectFixture => {
  const dir = mkdtempSync(join(tmpdir(), "upload-workflow-test-"));
  const appJson = options.appJson ?? baseAppJson;
  writeFileSync(join(dir, "app.json"), JSON.stringify(appJson, null, 2));
  const artifactPath = join(dir, "artifact.ipa");
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
  Layer.succeed(ApiClientService, { get: Effect.succeed(api) });

const makePresignedUploadLayer = (
  put: PresignedUploadClient["Type"]["putToPresignedUrl"] = () => Effect.void,
) => Layer.succeed(PresignedUploadClient, { putToPresignedUrl: put });

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

// Run the workflow after process.chdir(projectDir) so relative "./app.json"
// Resolves inside the fixture. Restore cwd and clean the temp dir in a
// Finalizer so test failures do not leak state across runs.
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
        appJson: {
          expo: {
            ...baseAppJson.expo,
            extra: {
              betterUpdate: {
                projectId: "proj_1",
                profiles: {
                  production: {
                    environment: "production",
                    android: { distribution: "direct", format: "apk" },
                  },
                },
              },
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

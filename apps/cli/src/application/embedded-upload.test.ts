import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { CommandExecutor } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import { UpdatePublishError } from "../lib/exit-codes";
import { makeInteractiveModeLayer } from "../lib/interactive-mode";
import { OutputModeLive } from "../lib/output-mode";
import { failureError } from "../lib/test-utils";
import { ApiClientService } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { IdentityStore } from "../services/identity-store";
import { UpdateAssetUploader } from "../services/update-asset-uploader";
import { runEmbeddedUpload } from "./embedded-upload";

import type { ApiClient } from "../services/api-client";
import type { UploadUpdateAssetInput } from "../services/update-asset-uploader";

const baseAppJson = {
  expo: {
    name: "Embedded Test App",
    slug: "embedded-test-app",
    version: "1.2.3",
    runtimeVersion: "1.2.3",
    ios: { bundleIdentifier: "com.example.embedded", buildNumber: "1" },
    android: { package: "com.example.embedded", versionCode: 1 },
    extra: { betterUpdate: { projectId: "proj_1" } },
  },
};

interface ProjectFixture {
  readonly dir: string;
  readonly bundlePath: string;
  readonly dispose: () => void;
}

const setupProject = (options: {
  readonly appJson?: Record<string, unknown>;
  readonly createBundle?: boolean;
  readonly bundleBytes?: Buffer;
}): ProjectFixture => {
  // realpathSync mirrors upload-workflow.test.ts — @expo/config rejects symlinked
  // project roots on macOS.
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "embedded-upload-test-")));
  writeFileSync(
    path.join(dir, "app.json"),
    JSON.stringify(options.appJson ?? baseAppJson, null, 2),
  );
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "embedded-upload-test", version: "1.0.0" }, null, 2),
  );
  const bundlePath = path.join(dir, "embedded.bundle");
  if (options.createBundle !== false) {
    writeFileSync(bundlePath, options.bundleBytes ?? Buffer.from("embedded launch bundle"));
  }
  return { dir, bundlePath, dispose: () => rmSync(dir, { recursive: true, force: true }) };
};

interface ApiRecorder {
  uploadPayload?: Record<string, unknown>;
  createPayload?: Record<string, unknown>;
}

const makeApi = (
  recorder: ApiRecorder,
  opts: { readonly alreadyStored?: boolean } = {},
): ApiClient =>
  ({
    assets: {
      upload: ({ payload }: { payload: Record<string, unknown> }) => {
        recorder.uploadPayload = payload;
        const assets = payload["assets"] as readonly { hash: string }[];
        return Effect.succeed({
          uploaded: opts.alreadyStored
            ? []
            : assets.map((asset) => ({
                hash: asset.hash,
                uploadUrl: "https://example.com/put",
                uploadExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                uploadHeaders: { "content-type": "application/javascript" },
              })),
          deduplicated: opts.alreadyStored ? assets.map((asset) => asset.hash) : [],
        });
      },
    },
    updates: {
      create: ({ payload }: { payload: Record<string, unknown> }) => {
        recorder.createPayload = payload;
        // The server persists + echoes back the client-pinned id (the embedded
        // baseline registers under it), so reflect that here.
        return Effect.succeed({ id: (payload["id"] as string | undefined) ?? "update_embedded_1" });
      },
    },
    "env-vars": { export: () => Effect.succeed({ items: [] }) },
  }) as unknown as ApiClient;

const makeApiClientLayer = (api: ApiClient) =>
  Layer.succeed(ApiClientService, {
    get: Effect.succeed(api),
    exchangeOneTimeToken: () => Effect.succeed("test-session-token"),
  });

const makeAssetUploaderLayer = (recorder: { uploads: UploadUpdateAssetInput[] }) =>
  Layer.succeed(UpdateAssetUploader, {
    uploadAssetBinary: (input: UploadUpdateAssetInput) =>
      Effect.sync(() => {
        recorder.uploads.push(input);
      }),
  });

// `readExpoPublicConfig` shells `bunx expo config --json` and JSON-parses the
// stdout, so the stub returns "{}". Git commands tolerate any stdout (catchAll),
// and runtime-version is resolved from the static app config (no fingerprint).
const stubCommandExecutorLayer = Layer.succeed(CommandExecutor.CommandExecutor, {
  [CommandExecutor.TypeId]: CommandExecutor.TypeId,
  string: () => Effect.succeed("{}"),
} as unknown as CommandExecutor.CommandExecutor);

const stubVaultLayer = Layer.mergeAll(
  makeInteractiveModeLayer(false),
  OutputModeLive,
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

const run = (
  project: ProjectFixture,
  api: ApiClient,
  uploadRecorder: { uploads: UploadUpdateAssetInput[] },
  options: Parameters<typeof runEmbeddedUpload>[0],
) => {
  const originalCwd = process.cwd();
  process.chdir(project.dir);
  return runEmbeddedUpload(options).pipe(
    Effect.provide(
      Layer.mergeAll(
        makeApiClientLayer(api),
        makeAssetUploaderLayer(uploadRecorder),
        makeCliRuntimeLayer(project.dir),
        NodeContext.layer,
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

// A valid lowercase app.manifest UUID — the value the device reports as
// expo-embedded-update-id; the baseline must be registered under THIS id.
const EMBEDDED_ID = "cccccccc-0000-0000-0000-aaaa00000000";

const baseOptions = (overrides: Partial<Parameters<typeof runEmbeddedUpload>[0]> = {}) => ({
  platform: "ios" as const,
  bundlePath: "embedded.bundle",
  embeddedId: EMBEDDED_ID,
  branch: "main",
  channel: undefined,
  runtimeVersion: undefined,
  message: undefined,
  environment: "production",
  auto: true,
  ...overrides,
});

describe(runEmbeddedUpload, () => {
  it.effect("uploads the launch bundle and registers an isEmbedded update", () =>
    Effect.gen(function* () {
      const project = setupProject({});
      const recorder: ApiRecorder = {};
      const uploadRecorder = { uploads: [] as UploadUpdateAssetInput[] };

      const result = yield* run(project, makeApi(recorder), uploadRecorder, baseOptions());

      // The create payload carries the embedded baseline flag + a single launch asset.
      expect(recorder.createPayload?.["isEmbedded"]).toBe(true);
      // The baseline is registered under the supplied app.manifest UUID, NOT a
      // server-minted id.
      expect(recorder.createPayload?.["id"]).toBe(EMBEDDED_ID);
      expect(recorder.createPayload?.["branch"]).toBe("main");
      expect(recorder.createPayload?.["platform"]).toBe("ios");
      expect(recorder.createPayload?.["runtimeVersion"]).toBe("1.2.3");
      const createAssets = recorder.createPayload?.["assets"] as readonly {
        hash: string;
        isLaunch: boolean;
        key: string;
      }[];
      expect(createAssets).toHaveLength(1);
      expect(createAssets[0]?.isLaunch).toBe(true);
      expect(createAssets[0]?.key).toBe("embedded.bundle");

      // The launch asset is namespaced as JavaScript and registered for upload.
      const uploadAssets = recorder.uploadPayload?.["assets"] as readonly {
        hash: string;
        contentType: string;
      }[];
      expect(uploadAssets[0]?.contentType).toBe("application/javascript");
      // The launch-asset hash in create matches the registered/uploaded hash.
      expect(createAssets[0]?.hash).toBe(uploadAssets[0]?.hash);
      expect(result.launchAssetHash).toBe(uploadAssets[0]?.hash);

      // Bytes were PUT to storage (not yet present server-side).
      expect(uploadRecorder.uploads).toHaveLength(1);
      expect(uploadRecorder.uploads[0]?.hash).toBe(result.launchAssetHash);
      expect(result.reused).toBe(false);
      // The registered baseline id is exactly the supplied embedded id.
      expect(result.updateId).toBe(EMBEDDED_ID);
    }),
  );

  it.effect("skips the binary PUT when the server already has the bytes", () =>
    Effect.gen(function* () {
      const project = setupProject({});
      const recorder: ApiRecorder = {};
      const uploadRecorder = { uploads: [] as UploadUpdateAssetInput[] };

      const result = yield* run(
        project,
        makeApi(recorder, { alreadyStored: true }),
        uploadRecorder,
        baseOptions(),
      );

      expect(uploadRecorder.uploads).toHaveLength(0);
      expect(result.reused).toBe(true);
      // The update is still registered against the existing launch asset.
      expect(recorder.createPayload?.["isEmbedded"]).toBe(true);
    }),
  );

  it.effect("honours an explicit --runtime-version over the app config", () =>
    Effect.gen(function* () {
      const project = setupProject({});
      const recorder: ApiRecorder = {};
      const uploadRecorder = { uploads: [] as UploadUpdateAssetInput[] };

      yield* run(
        project,
        makeApi(recorder),
        uploadRecorder,
        baseOptions({ runtimeVersion: "9.9.9" }),
      );

      expect(recorder.createPayload?.["runtimeVersion"]).toBe("9.9.9");
    }),
  );

  it.effect("fails with UpdatePublishError when the bundle file is missing", () =>
    Effect.gen(function* () {
      const project = setupProject({ createBundle: false });
      const recorder: ApiRecorder = {};
      const uploadRecorder = { uploads: [] as UploadUpdateAssetInput[] };

      const exit = yield* run(project, makeApi(recorder), uploadRecorder, baseOptions()).pipe(
        Effect.exit,
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = failureError(exit);
        expect(err).toBeInstanceOf(UpdatePublishError);
        expect((err as UpdatePublishError).message).toContain("Embedded bundle not found");
      }
      // No registration happens when the bundle is absent.
      expect(recorder.uploadPayload).toBeUndefined();
    }),
  );

  it.effect("fails with UpdatePublishError before any upload when --embedded-id is malformed", () =>
    Effect.gen(function* () {
      const project = setupProject({});
      const recorder: ApiRecorder = {};
      const uploadRecorder = { uploads: [] as UploadUpdateAssetInput[] };

      const exit = yield* run(
        project,
        makeApi(recorder),
        uploadRecorder,
        baseOptions({ embeddedId: "NOT-A-UUID" }),
      ).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = failureError(exit);
        expect(err).toBeInstanceOf(UpdatePublishError);
        expect((err as UpdatePublishError).message).toContain("Invalid --embedded-id");
      }
      // Fail-fast: no asset registration + no bytes PUT for a malformed id.
      expect(recorder.uploadPayload).toBeUndefined();
      expect(uploadRecorder.uploads).toHaveLength(0);
    }),
  );
});

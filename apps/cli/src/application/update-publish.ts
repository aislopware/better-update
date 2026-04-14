import { randomUUID } from "node:crypto";
import path from "node:path";

import { CommandExecutor, FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { readAppJson, readProjectId, readScopeKey } from "../lib/app-json";
import { readRuntimeVersionMeta, type Platform } from "../lib/build-profile";
import { pullEnvVars } from "../lib/env-exporter";
import { EnvExportError, RuntimeVersionError, UpdatePublishError } from "../lib/exit-codes";
import { readExpoExportAssets, readExpoPublicConfig, runExpoExport } from "../lib/expo-export";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { sha256FileBase64Url } from "../lib/sha256";
import { loadSignedPublishPayloads, type SignedPayload } from "../lib/signed-payloads";
import { acquireBuildTempDir } from "../lib/temp-dir";
import { resolveUpdatePlatforms } from "../lib/update-platforms";
import { ApiClientService, apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { UpdateAssetUploader } from "../services/update-asset-uploader";

import type {
  AuthRequiredError,
  BuildProfileError,
  BuildFailedError,
  ProjectNotLinkedError,
} from "../lib/exit-codes";

export interface RunUpdatePublishOptions {
  readonly branch: string;
  readonly platform: Platform | "all";
  readonly message: string | undefined;
  readonly environment: string;
  readonly clear: boolean;
  readonly manifestBodyFile: string | undefined;
  readonly signatureFile: string | undefined;
  readonly certificateChainFile: string | undefined;
  readonly manifestBodyFileIos: string | undefined;
  readonly signatureFileIos: string | undefined;
  readonly certificateChainFileIos: string | undefined;
  readonly manifestBodyFileAndroid: string | undefined;
  readonly signatureFileAndroid: string | undefined;
  readonly certificateChainFileAndroid: string | undefined;
}

export interface PublishedPlatformResult {
  readonly platform: Platform;
  readonly updateId: string;
  readonly runtimeVersion: string;
  readonly uploadedAssets: number;
  readonly deduplicatedAssets: number;
}

export interface PublishUpdatesResult {
  readonly groupId: string;
  readonly branch: string;
  readonly results: readonly PublishedPlatformResult[];
}

interface PreparedAsset {
  readonly path: string;
  readonly key: string;
  readonly hash: string;
  readonly byteSize: number;
  readonly contentType: string;
  readonly fileExt: string;
  readonly isLaunch: boolean;
}

const formatCause = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "object" && cause !== null) {
    const tagged = cause as { readonly _tag?: unknown; readonly message?: unknown };
    const tag = typeof tagged._tag === "string" ? tagged._tag : undefined;
    const message = typeof tagged.message === "string" ? tagged.message : undefined;
    if (tag && message) return `${tag}: ${message}`;
    if (message) return message;
    if (tag) return tag;
  }
  return String(cause);
};

const buildUpdateExtra = (expoClient: Record<string, unknown>, projectId: string) => ({
  expoClient,
  eas: { projectId },
});

const dedupeAssetsByHash = (assets: readonly PreparedAsset[]): readonly PreparedAsset[] => {
  const unique = new Map<string, PreparedAsset>();
  for (const asset of assets) {
    if (!unique.has(asset.hash)) {
      unique.set(asset.hash, asset);
    }
  }
  return Array.from(unique.values());
};

const preparePlatformAssets = ({
  exportDir,
  platform,
}: {
  readonly exportDir: string;
  readonly platform: Platform;
}): Effect.Effect<
  readonly PreparedAsset[],
  UpdatePublishError | BuildFailedError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const exportedAssets = yield* readExpoExportAssets({ exportDir, platform });
    return yield* Effect.forEach(
      exportedAssets,
      (asset) =>
        sha256FileBase64Url(asset.path).pipe(
          Effect.map(({ sha256Base64Url, byteSize }) => ({
            ...asset,
            hash: sha256Base64Url,
            byteSize,
          })),
        ),
      { concurrency: 4 },
    );
  });

const publishPlatform = (params: {
  readonly projectRoot: string;
  readonly exportDir: string;
  readonly projectId: string;
  readonly scopeKey: string;
  readonly branch: string;
  readonly groupId: string;
  readonly message: string;
  readonly environmentVars: Record<string, string>;
  readonly expoClientConfig: Record<string, unknown>;
  readonly clear: boolean;
  readonly appJson: Record<string, unknown>;
  readonly platform: Platform;
  readonly signedPayload: SignedPayload | null;
}): Effect.Effect<
  PublishedPlatformResult,
  | AuthRequiredError
  | UpdatePublishError
  | BuildProfileError
  | BuildFailedError
  | RuntimeVersionError,
  | ApiClientService
  | CliRuntime
  | UpdateAssetUploader
  | CommandExecutor.CommandExecutor
  | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const assetUploader = yield* UpdateAssetUploader;

    const runtimeVersionMeta = yield* readRuntimeVersionMeta(params.appJson);
    const runtimeVersion = yield* resolveRuntimeVersion({
      raw: runtimeVersionMeta.rawRuntimeVersion,
      appVersion: runtimeVersionMeta.appVersion,
      projectRoot: params.projectRoot,
    });

    yield* runExpoExport({
      projectRoot: params.projectRoot,
      exportDir: params.exportDir,
      platform: params.platform,
      envVars: params.environmentVars,
      clear: params.clear,
    });

    const preparedAssets = yield* preparePlatformAssets({
      exportDir: params.exportDir,
      platform: params.platform,
    });
    const uniqueAssets = dedupeAssetsByHash(preparedAssets);

    const assetRegistration = yield* api.assets
      .upload({
        payload: {
          projectId: params.projectId,
          assets: uniqueAssets.map((asset) => ({
            hash: asset.hash,
            contentType: asset.contentType,
            fileExt: asset.fileExt,
          })),
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new UpdatePublishError({
              message: `Failed to register ${params.platform} assets: ${formatCause(cause)}`,
            }),
        ),
      );

    const uploadTokensByHash = new Map(
      assetRegistration.uploaded.map((asset) => [asset.hash, asset.uploadToken] as const),
    );
    yield* Effect.forEach(
      uniqueAssets.filter((asset) => uploadTokensByHash.has(asset.hash)),
      (asset) =>
        assetUploader.uploadAssetBinary({
          path: asset.path,
          hash: asset.hash,
          uploadToken: uploadTokensByHash.get(asset.hash) ?? "",
          byteSize: asset.byteSize,
          contentType: asset.contentType,
        }),
      { concurrency: 4 },
    );

    const update = yield* api.updates
      .create({
        payload: {
          branch: params.branch,
          project: params.scopeKey,
          runtimeVersion,
          platform: params.platform,
          message: params.message,
          groupId: params.groupId,
          metadata: {},
          extra: buildUpdateExtra(params.expoClientConfig, params.projectId),
          assets: preparedAssets.map((asset) => ({
            hash: asset.hash,
            key: asset.key,
            isLaunch: asset.isLaunch,
          })),
          ...(params.signedPayload
            ? {
                manifestBody: params.signedPayload.manifestBody,
                signature: params.signedPayload.signature,
                certificateChain: params.signedPayload.certificateChain,
              }
            : {}),
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new UpdatePublishError({
              message: `Failed to publish ${params.platform} update: ${formatCause(cause)}`,
            }),
        ),
      );

    return {
      platform: params.platform,
      updateId: update.id,
      runtimeVersion,
      uploadedAssets: assetRegistration.uploaded.length,
      deduplicatedAssets: assetRegistration.deduplicated.length,
    } as const satisfies PublishedPlatformResult;
  });

export const runUpdatePublish = (
  options: RunUpdatePublishOptions,
): Effect.Effect<
  PublishUpdatesResult,
  | AuthRequiredError
  | UpdatePublishError
  | ProjectNotLinkedError
  | BuildProfileError
  | RuntimeVersionError
  | EnvExportError
  | BuildFailedError,
  | ApiClientService
  | CliRuntime
  | UpdateAssetUploader
  | CommandExecutor.CommandExecutor
  | FileSystem.FileSystem
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const runtime = yield* CliRuntime;
      const projectRoot = yield* runtime.cwd;
      const api = yield* apiClient;

      const projectId = yield* readProjectId;
      const scopeKey = yield* readScopeKey;
      const appJson = yield* readAppJson;
      const platforms = resolveUpdatePlatforms(appJson, options.platform);
      if (platforms.length === 0) {
        return yield* new UpdatePublishError({
          message:
            'No publishable platforms found in app.json. Add an "expo.ios" or "expo.android" section, or pass --platform explicitly.',
        });
      }

      const environmentVars = yield* pullEnvVars(api, {
        projectId,
        environment: options.environment,
      });
      const expoClientConfig = yield* readExpoPublicConfig({
        projectRoot,
        envVars: environmentVars,
      });
      const tempDir = yield* acquireBuildTempDir.pipe(
        Effect.mapError(
          (cause) =>
            new UpdatePublishError({
              message: `Failed to create a temporary export directory: ${formatCause(cause)}`,
            }),
        ),
      );
      const groupId = randomUUID();
      const message = options.message ?? "Publish via better-update CLI";
      const signedPayloads = yield* loadSignedPublishPayloads({
        platforms,
        globalFiles: {
          manifestBodyFile: options.manifestBodyFile,
          signatureFile: options.signatureFile,
          certificateChainFile: options.certificateChainFile,
        },
        platformFiles: {
          ios: {
            manifestBodyFile: options.manifestBodyFileIos,
            signatureFile: options.signatureFileIos,
            certificateChainFile: options.certificateChainFileIos,
          },
          android: {
            manifestBodyFile: options.manifestBodyFileAndroid,
            signatureFile: options.signatureFileAndroid,
            certificateChainFile: options.certificateChainFileAndroid,
          },
        },
        makeError: (message) => new UpdatePublishError({ message }),
      });
      const results: PublishedPlatformResult[] = [];

      yield* Effect.forEach(
        platforms,
        (platform) =>
          publishPlatform({
            projectRoot,
            exportDir: path.join(tempDir, `export-${platform}`),
            projectId,
            scopeKey,
            branch: options.branch,
            groupId,
            message,
            environmentVars,
            expoClientConfig,
            clear: options.clear,
            appJson,
            platform,
            signedPayload: signedPayloads[platform] ?? null,
          }).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                results.push(result);
              }),
            ),
          ),
        { concurrency: 1 },
      );

      return {
        groupId,
        branch: options.branch,
        results,
      } as const satisfies PublishUpdatesResult;
    }),
  );

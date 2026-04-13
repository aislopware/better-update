import { randomUUID } from "node:crypto";
import path from "node:path";

import { CommandExecutor, FileSystem, HttpClient, HttpClientRequest } from "@effect/platform";
import { Effect } from "effect";

import { readAppJson, readProjectId, readScopeKey } from "./app-json";
import { readRuntimeVersionMeta, type Platform } from "./build-profile";
import { pullEnvVars } from "./env-exporter";
import { EnvExportError, UpdatePublishError } from "./exit-codes";
import { readExpoExportAssets, readExpoPublicConfig, runExpoExport } from "./expo-export";
import { resolveRuntimeVersion } from "./runtime-version";
import { sha256FileBase64Url } from "./sha256";
import { acquireBuildTempDir } from "./temp-dir";

import type { ApiClient } from "../services/api-client";
import type {
  BuildProfileError,
  BuildFailedError,
  ProjectNotLinkedError,
  RuntimeVersionError,
} from "./exit-codes";

export interface PublishUpdatesOptions {
  readonly projectRoot: string;
  readonly branch: string;
  readonly platform: Platform | "all";
  readonly message: string | undefined;
  readonly environment: string;
  readonly clear: boolean;
}

export interface PublishUpdatesAuth {
  readonly token: string;
  readonly baseUrl: string;
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

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

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

export const resolvePublishPlatforms = (
  appJson: Record<string, unknown>,
  requestedPlatform: Platform | "all",
): readonly Platform[] => {
  if (requestedPlatform !== "all") {
    return [requestedPlatform] as const;
  }

  const expo = asRecord(appJson["expo"]);
  const platforms: Platform[] = [];
  if (asRecord(expo?.["ios"])) {
    platforms.push("ios");
  }
  if (asRecord(expo?.["android"])) {
    platforms.push("android");
  }
  return platforms;
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

const uploadAssetBinary = (params: {
  readonly asset: PreparedAsset;
  readonly token: string;
  readonly baseUrl: string;
}): Effect.Effect<void, UpdatePublishError, HttpClient.HttpClient | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const uploadUrl = new URL(
      `/api/assets/${encodeURIComponent(params.asset.hash)}`,
      params.baseUrl,
    );

    const request = yield* HttpClientRequest.put(uploadUrl.toString()).pipe(
      HttpClientRequest.setHeaders({
        Authorization: `Bearer ${params.token}`,
        "Content-Type": params.asset.contentType,
        "Content-Length": String(params.asset.byteSize),
      }),
      HttpClientRequest.bodyFile(params.asset.path),
      Effect.mapError(
        (cause) =>
          new UpdatePublishError({
            message: `Failed to read asset for upload: ${formatCause(cause)}`,
          }),
      ),
    );

    const response = yield* client.execute(request).pipe(
      Effect.mapError(
        (cause) =>
          new UpdatePublishError({
            message: `Asset upload request failed: ${formatCause(cause)}`,
          }),
      ),
    );

    if (response.status < 200 || response.status >= 300) {
      const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
      return yield* new UpdatePublishError({
        message: `Asset upload failed with status ${String(response.status)}: ${body}`,
      });
    }
  });

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
  readonly api: ApiClient;
  readonly auth: PublishUpdatesAuth;
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
}): Effect.Effect<
  PublishedPlatformResult,
  UpdatePublishError | BuildProfileError | BuildFailedError | RuntimeVersionError,
  CommandExecutor.CommandExecutor | HttpClient.HttpClient | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
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

    const assetRegistration = yield* params.api.assets
      .upload({
        payload: {
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

    const uploadedHashes = new Set(assetRegistration.uploaded);
    yield* Effect.forEach(
      uniqueAssets.filter((asset) => uploadedHashes.has(asset.hash)),
      (asset) =>
        uploadAssetBinary({
          asset,
          token: params.auth.token,
          baseUrl: params.auth.baseUrl,
        }),
      { concurrency: 4 },
    );

    const update = yield* params.api.updates
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

export const publishUpdates = (
  api: ApiClient,
  auth: PublishUpdatesAuth,
  options: PublishUpdatesOptions,
): Effect.Effect<
  PublishUpdatesResult,
  | UpdatePublishError
  | ProjectNotLinkedError
  | BuildProfileError
  | RuntimeVersionError
  | EnvExportError
  | BuildFailedError,
  CommandExecutor.CommandExecutor | HttpClient.HttpClient | FileSystem.FileSystem
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const projectId = yield* readProjectId;
      const scopeKey = yield* readScopeKey;
      const appJson = yield* readAppJson;
      const platforms = resolvePublishPlatforms(appJson, options.platform);
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
        projectRoot: options.projectRoot,
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
      const results: PublishedPlatformResult[] = [];

      yield* Effect.forEach(
        platforms,
        (platform) =>
          publishPlatform({
            api,
            auth,
            projectRoot: options.projectRoot,
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
          }).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                results.push(result);
              }),
            ),
          ),
        { concurrency: 1 },
      ).pipe(
        Effect.catchAll((error) =>
          results.length === 0
            ? Effect.fail(error)
            : api.updates.deleteGroup({ path: { groupId } }).pipe(
                Effect.catchAll(() => Effect.void),
                Effect.zipRight(Effect.fail(error)),
              ),
        ),
      );

      return {
        groupId,
        branch: options.branch,
        results,
      } as const satisfies PublishUpdatesResult;
    }),
  );

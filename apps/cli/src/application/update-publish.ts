import { randomUUID } from "node:crypto";
import path from "node:path";

import { fromHex, toBase64Url } from "@better-update/encoding";
import { Effect } from "effect";
import { uniqBy } from "es-toolkit";

import type { CommandExecutor, FileSystem } from "@effect/platform";

import { readRuntimeVersionMeta } from "../lib/build-profile";
import { pullEnvVars } from "../lib/env-exporter";
import { UpdatePublishError } from "../lib/exit-codes";
import { extractProjectId, extractSlug, readExpoConfig } from "../lib/expo-config";
import { readExpoExportAssets, readExpoPublicConfig, runExpoExport } from "../lib/expo-export";
import { formatCause } from "../lib/format-error";
import { readGitContext } from "../lib/git-context";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { sha256File, sha256Namespaced } from "../lib/sha256";
import { loadSignedPublishPayloads } from "../lib/signed-payloads";
import { acquireBuildTempDir } from "../lib/temp-dir";
import { resolveUpdatePlatforms } from "../lib/update-platforms";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { UpdateAssetUploader } from "../services/update-asset-uploader";

import type { Platform } from "../lib/build-profile";
import type {
  AuthRequiredError,
  BuildProfileError,
  BuildFailedError,
  ProjectNotLinkedError,
  EnvExportError,
  RuntimeVersionError,
} from "../lib/exit-codes";
import type { ExpoConfig } from "../lib/expo-config";
import type { SignedPayload } from "../lib/signed-payloads";
import type { ApiClientService } from "../services/api-client";

export interface RunUpdatePublishOptions {
  readonly branch: string | undefined;
  readonly platform: Platform | "all";
  readonly message: string | undefined;
  readonly auto: boolean;
  readonly environment: string;
  readonly clear: boolean;
  readonly rolloutPercentage: number | undefined;
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
  readonly contentChecksum: string;
  readonly byteSize: number;
  readonly contentType: string;
  readonly fileExt: string;
  readonly isLaunch: boolean;
}

const buildUpdateExtra = (
  expoClient: Record<string, unknown>,
  projectId: string,
  environment: string,
) => ({
  expoClient,
  eas: { projectId },
  environment,
});

const dedupeAssetsByHash = (assets: readonly PreparedAsset[]): readonly PreparedAsset[] =>
  uniqBy(assets, (asset) => asset.hash);

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
        sha256File(asset.path).pipe(
          Effect.map(({ sha256: contentSha256Hex, byteSize }) => ({
            ...asset,
            hash: sha256Namespaced(asset.contentType, contentSha256Hex),
            contentChecksum: toBase64Url(fromHex(contentSha256Hex)),
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
  readonly slug: string;
  readonly branch: string;
  readonly groupId: string;
  readonly message: string;
  readonly environment: string;
  readonly environmentVars: Record<string, string>;
  readonly expoClientConfig: Record<string, unknown>;
  readonly clear: boolean;
  readonly expoConfig: ExpoConfig;
  readonly platform: Platform;
  readonly signedPayload: SignedPayload | null;
  readonly rolloutPercentage: number | undefined;
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

    const runtimeVersionMeta = readRuntimeVersionMeta(params.expoConfig);
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
            contentChecksum: asset.contentChecksum,
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

    const uploadDetailsByHash = new Map(
      assetRegistration.uploaded.map((asset) => [asset.hash, asset] as const),
    );
    yield* Effect.forEach(
      uniqueAssets.filter((asset) => uploadDetailsByHash.has(asset.hash)),
      (asset) =>
        Effect.gen(function* () {
          const detail = uploadDetailsByHash.get(asset.hash);
          if (!detail) {
            return yield* Effect.fail(
              new UpdatePublishError({
                message: `Missing upload details for asset ${asset.hash}`,
              }),
            );
          }
          return yield* assetUploader.uploadAssetBinary({
            path: asset.path,
            hash: asset.hash,
            byteSize: asset.byteSize,
            uploadUrl: detail.uploadUrl,
            uploadExpiresAt: detail.uploadExpiresAt,
            uploadHeaders: detail.uploadHeaders,
          });
        }),
      { concurrency: 4 },
    );

    const update = yield* api.updates
      .create({
        payload: {
          branch: params.branch,
          slug: params.slug,
          runtimeVersion,
          platform: params.platform,
          message: params.message,
          groupId: params.groupId,
          metadata: {},
          extra: buildUpdateExtra(params.expoClientConfig, params.projectId, params.environment),
          assets: preparedAssets.map((asset) => ({
            hash: asset.hash,
            key: asset.key,
            isLaunch: asset.isLaunch,
            contentChecksum: asset.contentChecksum,
          })),
          ...(params.signedPayload
            ? {
                manifestBody: params.signedPayload.manifestBody,
                signature: params.signedPayload.signature,
                certificateChain: params.signedPayload.certificateChain,
              }
            : {}),
          ...(params.rolloutPercentage === undefined
            ? {}
            : { rolloutPercentage: params.rolloutPercentage }),
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
    // eslint-disable-next-line eslint/max-statements -- update publish orchestration is inherently sequential (read config → resolve runtime version → expo export → register assets → publish per platform); splitting further fragments the pipeline without improving readability
    Effect.gen(function* () {
      const runtime = yield* CliRuntime;
      const projectRoot = yield* runtime.cwd;
      const api = yield* apiClient;

      const baseConfig = yield* readExpoConfig(projectRoot);
      const projectId = yield* extractProjectId(baseConfig);
      const slug = yield* extractSlug(baseConfig);

      const environmentVars = yield* pullEnvVars(api, {
        projectId,
        environment: options.environment,
      });

      const expoConfig = yield* readExpoConfig(projectRoot, environmentVars);
      const platforms = resolveUpdatePlatforms(expoConfig, options.platform);
      if (platforms.length === 0) {
        return yield* new UpdatePublishError({
          message:
            'No publishable platforms found in your Expo config. Add an "ios" or "android" section, or pass --platform explicitly.',
        });
      }
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
      let resolvedBranch = options.branch;
      let resolvedMessage = options.message;

      if (options.auto) {
        const gitContext = yield* readGitContext(projectRoot);
        if (!resolvedBranch) {
          if (!gitContext.ref) {
            return yield* new UpdatePublishError({
              message:
                "Cannot infer branch from git. Ensure you are in a git repo with a checked-out branch, or provide --branch explicitly.",
            });
          }
          resolvedBranch = gitContext.ref;
        }
        if (!resolvedMessage && gitContext.commitMessage) {
          resolvedMessage = gitContext.commitMessage;
        }
      }

      if (!resolvedBranch) {
        return yield* new UpdatePublishError({
          message: "Missing --branch. Provide it explicitly or use --auto to infer from git.",
        });
      }

      const branch = resolvedBranch;
      const groupId = randomUUID();
      const message = resolvedMessage ?? "Publish via better-update CLI";
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
        makeError: (errorMessage) => new UpdatePublishError({ message: errorMessage }),
      });
      const results = yield* Effect.forEach(
        platforms,
        (platform) =>
          publishPlatform({
            projectRoot,
            exportDir: path.join(tempDir, `export-${platform}`),
            projectId,
            slug,
            branch,
            groupId,
            message,
            environment: options.environment,
            environmentVars,
            expoClientConfig,
            clear: options.clear,
            expoConfig,
            platform,
            // eslint-disable-next-line eslint-js/no-restricted-syntax -- signedPayload absence means unsigned; null is correct downstream
            signedPayload: signedPayloads[platform] ?? null,
            rolloutPercentage: options.rolloutPercentage,
          }),
        { concurrency: 1 },
      );

      return {
        groupId,
        branch,
        results,
      } as const satisfies PublishUpdatesResult;
    }),
  );

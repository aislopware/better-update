import { randomUUID } from "node:crypto";
import path from "node:path";

import { fromHex, toBase64Url } from "@better-update/encoding";
import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { uniqBy } from "es-toolkit";

import type { CommandExecutor, FileSystem } from "@effect/platform";

import { readRuntimeVersionMeta } from "../lib/build-profile";
import { pullEnvVars } from "../lib/env-exporter";
import { UpdatePublishError } from "../lib/exit-codes";
import { extractProjectId, extractSlug, readExpoConfig } from "../lib/expo-config";
import { readExpoExportAssets, readExpoPublicConfig, runExpoExport } from "../lib/expo-export";
import { runFingerprintFull } from "../lib/fingerprint";
import { formatCause } from "../lib/format-error";
import { readGitContext } from "../lib/git-context";
import { InteractiveMode } from "../lib/interactive-mode";
import { ensureRepoClean } from "../lib/repo-clean";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { sha256File, sha256Namespaced } from "../lib/sha256";
import { loadSignedPublishPayloads } from "../lib/signed-payloads";
import { acquireBuildTempDir } from "../lib/temp-dir";
import { resolveUpdatePlatforms } from "../lib/update-platforms";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { UpdateAssetUploader } from "../services/update-asset-uploader";
import {
  confirmPublishPreview,
  emitMetadataFile,
  resolveBranchAndMessage,
} from "./update-publish-helpers";

import type { Platform } from "../lib/build-profile";
import type {
  AuthRequiredError,
  BuildProfileError,
  BuildFailedError,
  DirtyRepoError,
  InteractiveProhibitedError,
  ProjectNotLinkedError,
  EnvExportError,
  RuntimeVersionError,
} from "../lib/exit-codes";
import type { ExpoConfig } from "../lib/expo-config";
import type { SignedPayload } from "../lib/signed-payloads";
import type { ApiClientService } from "../services/api-client";
import type { IdentityStore } from "../services/identity-store";

export interface RunUpdatePublishOptions {
  readonly branch: string | undefined;
  readonly channel: string | undefined;
  readonly platform: Platform | "all";
  readonly message: string | undefined;
  readonly auto: boolean;
  readonly environment: string;
  readonly clear: boolean;
  readonly allowDirty: boolean;
  readonly rolloutPercentage: number | undefined;
  readonly inputDir: string | undefined;
  readonly skipBundler: boolean;
  readonly emitMetadata: boolean;
  readonly noBytecode: boolean;
  readonly sourceMaps: boolean;
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
  readonly fingerprintHash: string | undefined;
  readonly skipBundler: boolean;
  readonly noBytecode: boolean;
  readonly sourceMaps: boolean;
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

    if (!params.skipBundler) {
      yield* runExpoExport({
        projectRoot: params.projectRoot,
        exportDir: params.exportDir,
        platform: params.platform,
        envVars: params.environmentVars,
        clear: params.clear,
        noBytecode: params.noBytecode,
        sourceMaps: params.sourceMaps,
      });
    }

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
          ...compact({
            rolloutPercentage: params.rolloutPercentage,
            fingerprintHash: params.fingerprintHash,
          }),
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
  | BuildFailedError
  | DirtyRepoError
  | InteractiveProhibitedError,
  | ApiClientService
  | CliRuntime
  | UpdateAssetUploader
  | CommandExecutor.CommandExecutor
  | FileSystem.FileSystem
  | InteractiveMode
  | IdentityStore
> =>
  Effect.scoped(
    // eslint-disable-next-line eslint/max-statements -- update publish orchestration is inherently sequential (read config → resolve runtime version → expo export → register assets → publish per platform); splitting further fragments the pipeline without improving readability
    Effect.gen(function* () {
      const runtime = yield* CliRuntime;
      const projectRoot = yield* runtime.cwd;
      const api = yield* apiClient;

      yield* ensureRepoClean({
        projectRoot,
        allowDirty: options.allowDirty,
        label: "update publish",
      });

      const baseConfig = yield* readExpoConfig(projectRoot);
      const projectId = yield* extractProjectId(baseConfig);

      const environmentVars = yield* pullEnvVars(api, {
        projectId,
        environment: options.environment,
      });

      // Read slug from the env-resolved config so dynamic configs that derive
      // slug from env vars publish under the same identity as `expo export`.
      const expoConfig = yield* readExpoConfig(projectRoot, environmentVars);
      const slug = yield* extractSlug(expoConfig);
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
      // readGitContext is best-effort (swallows errors); cheap to call once.
      const gitCtx = yield* readGitContext(projectRoot);
      const envBranch = (yield* runtime.getEnv("BETTER_UPDATE_BRANCH"))?.trim();
      const { branch, message: resolvedMessage } = yield* resolveBranchAndMessage({
        client: api,
        projectId,
        branchArg: options.branch,
        messageArg: options.message,
        channelArg: options.channel,
        auto: options.auto,
        gitCtx,
        envBranch,
      });

      if (options.skipBundler && options.inputDir === undefined) {
        return yield* new UpdatePublishError({
          message: "--skip-bundler requires --input-dir <path> pointing to a pre-bundled export.",
        });
      }

      const sharedExportDir =
        options.inputDir === undefined ? undefined : path.resolve(projectRoot, options.inputDir);

      const groupId = randomUUID();
      const message = resolvedMessage ?? "Publish via better-update CLI";
      const fingerprintHash = yield* runFingerprintFull(projectRoot).pipe(
        Effect.map((result) => result.hash),
        Effect.catchAll(() => Effect.succeed(undefined)),
      );

      const interactive = yield* InteractiveMode;
      if (interactive.allow && !options.auto) {
        const confirmed = yield* confirmPublishPreview({
          branch,
          platforms,
          message,
          environment: options.environment,
        });
        if (!confirmed) {
          return yield* new UpdatePublishError({ message: "Publish cancelled." });
        }
      }
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
            exportDir: sharedExportDir ?? path.join(tempDir, `export-${platform}`),
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
            fingerprintHash,
            skipBundler: options.skipBundler,
            noBytecode: options.noBytecode,
            sourceMaps: options.sourceMaps,
          }),
        { concurrency: 1 },
      );

      if (options.emitMetadata) {
        const dir = sharedExportDir ?? tempDir;
        yield* emitMetadataFile({
          dir,
          groupId,
          branch,
          channel: options.channel,
          message,
          results,
        });
      }

      return {
        groupId,
        branch,
        results,
      } as const satisfies PublishUpdatesResult;
    }),
  );

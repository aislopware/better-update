import { randomUUID } from "node:crypto";
import path from "node:path";

import { fromHex, toBase64Url } from "@better-update/encoding";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { readRuntimeVersionMeta } from "../lib/build-profile";
import { pullEnvVars } from "../lib/env-exporter";
import { UpdatePublishError } from "../lib/exit-codes";
import { extractProjectId, extractSlug, readExpoConfig } from "../lib/expo-config";
import { readExpoPublicConfig } from "../lib/expo-export";
import { formatCause } from "../lib/format-error";
import { readGitContext } from "../lib/git-context";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { sha256File, sha256Namespaced } from "../lib/sha256";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { UpdateAssetUploader } from "../services/update-asset-uploader";
import { resolveBranchAndMessage } from "./update-publish-helpers";

import type { Platform } from "../lib/build-profile";
import type { ApiClient } from "../services/api-client";

// The embedded launch bundle is the Hermes/JS bundle baked into the native
// build. Like every launch asset it is namespaced + served as JavaScript, so
// its bytes live at assets/{hash} and become the byte-identical patch base for
// first-launch bsdiff patches.
const LAUNCH_CONTENT_TYPE = "application/javascript";

// Lowercase 8-4-4-4-12 hex UUID. The embedded baseline id MUST equal the
// device-reported `expo-embedded-update-id`, which is lowercase, so reject any
// other casing/shape client-side before any upload (a typo never reaches the
// server).
const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Normalize (trim + lowercase) and validate the supplied embedded id, failing
 * fast with UpdatePublishError before any upload so a malformed value never
 * reaches the server. Lowercasing matches the device-reported
 * `expo-embedded-update-id`.
 */
const normalizeEmbeddedId = (raw: string): Effect.Effect<string, UpdatePublishError> => {
  const embeddedId = raw.trim().toLowerCase();
  return LOWERCASE_UUID.test(embeddedId)
    ? Effect.succeed(embeddedId)
    : Effect.fail(
        new UpdatePublishError({
          message: `Invalid --embedded-id "${raw}". It must be the lowercase app.manifest UUID (8-4-4-4-12 hex) baked into the native build — the value the device reports as expo-embedded-update-id.`,
        }),
      );
};

export interface RunEmbeddedUploadOptions {
  readonly branch: string | undefined;
  readonly channel: string | undefined;
  readonly platform: Platform;
  readonly bundlePath: string;
  // The lowercase app.manifest UUID baked into the native build — the value the
  // device reports as `expo-embedded-update-id`. Becomes the embedded baseline's
  // registered id (CreateUpdateBody.id), so first-launch patches keyed by it
  // resolve against this row.
  readonly embeddedId: string;
  readonly runtimeVersion: string | undefined;
  readonly message: string | undefined;
  readonly environment: string;
  readonly auto: boolean;
}

export interface EmbeddedUploadResult {
  readonly updateId: string;
  readonly branch: string;
  readonly platform: Platform;
  readonly runtimeVersion: string;
  readonly launchAssetHash: string;
  readonly reused: boolean;
}

interface PreparedLaunchAsset {
  readonly hash: string;
  readonly contentChecksum: string;
  readonly key: string;
  readonly reused: boolean;
}

/**
 * Hash the embedded launch bundle, register it, and PUT its bytes to
 * assets/{hash} (skipped when the server already has identical bytes). The
 * embedded launch asset MUST live where every launch asset does so it is the
 * byte-identical base for first-launch bsdiff patches.
 */
const prepareEmbeddedLaunchAsset = ({
  api,
  assetUploader,
  projectId,
  bundlePath,
}: {
  readonly api: ApiClient;
  readonly assetUploader: typeof UpdateAssetUploader.Service;
  readonly projectId: string;
  readonly bundlePath: string;
}) =>
  Effect.gen(function* () {
    const { sha256: contentSha256Hex, byteSize } = yield* sha256File(bundlePath);
    const hash = sha256Namespaced(LAUNCH_CONTENT_TYPE, contentSha256Hex);
    const contentChecksum = toBase64Url(fromHex(contentSha256Hex));

    const registration = yield* api.assets
      .upload({
        payload: {
          projectId,
          assets: [{ hash, contentType: LAUNCH_CONTENT_TYPE, fileExt: "bundle", contentChecksum }],
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new UpdatePublishError({
              message: `Failed to register embedded launch asset: ${formatCause(cause)}`,
            }),
        ),
      );

    const pendingUpload = registration.uploaded.find((asset) => asset.hash === hash);
    if (pendingUpload) {
      yield* assetUploader.uploadAssetBinary({
        path: bundlePath,
        hash,
        byteSize,
        uploadUrl: pendingUpload.uploadUrl,
        uploadExpiresAt: pendingUpload.uploadExpiresAt,
        uploadHeaders: pendingUpload.uploadHeaders,
      });
    }

    return {
      hash,
      contentChecksum,
      key: path.posix.basename(bundlePath),
      reused: pendingUpload === undefined,
    } as const satisfies PreparedLaunchAsset;
  });

/**
 * Register an embedded baseline: PUT the launch-bundle BYTES to assets/{hash}
 * (the diffable patch base) and create an isEmbedded update whose id is pinned to
 * the binary's app.manifest UUID (options.embeddedId), so the device's
 * expo-embedded-update-id matches this row.
 *
 * SHIP-DORMANT: this is pure data correctness — it serves nothing new to GA
 * clients. The embedded baseline is probed only when expo's (currently-unreleased)
 * embedded-base patch opt-in ships AND a precomputed embedded-base patch object
 * exists in R2 (which this flow does NOT create). See the command-file header for
 * the build-pipeline + device-verify prerequisites; this flow does NOT claim
 * GA-client functionality.
 */
export const runEmbeddedUpload = (options: RunEmbeddedUploadOptions) =>
  Effect.gen(function* () {
    // Validate the embedded id BEFORE any upload (fail-fast, never reaches the
    // server).
    const embeddedId = yield* normalizeEmbeddedId(options.embeddedId);

    const runtime = yield* CliRuntime;
    const projectRoot = yield* runtime.cwd;
    const api = yield* apiClient;
    const assetUploader = yield* UpdateAssetUploader;
    const fs = yield* FileSystem.FileSystem;

    const bundlePath = path.resolve(projectRoot, options.bundlePath);
    const bundleExists = yield* fs
      .exists(bundlePath)
      .pipe(Effect.mapError((cause) => new UpdatePublishError({ message: formatCause(cause) })));
    if (!bundleExists) {
      return yield* new UpdatePublishError({
        message: `Embedded bundle not found at ${bundlePath}. Pass --bundle <path> pointing at the launch bundle baked into the native build.`,
      });
    }

    const baseConfig = yield* readExpoConfig(projectRoot);
    const projectId = yield* extractProjectId(baseConfig);

    const environmentVars = yield* pullEnvVars(api, {
      projectId,
      environment: options.environment,
    });
    const expoConfig = yield* readExpoConfig(projectRoot, environmentVars);
    const slug = yield* extractSlug(expoConfig);
    const expoClientConfig = yield* readExpoPublicConfig({ projectRoot, envVars: environmentVars });

    const runtimeVersionMeta = readRuntimeVersionMeta(expoConfig, options.platform);
    const runtimeVersion =
      options.runtimeVersion ??
      (yield* resolveRuntimeVersion({
        raw: runtimeVersionMeta.rawRuntimeVersion,
        appVersion: runtimeVersionMeta.appVersion,
        projectRoot,
        platform: options.platform,
        buildNumber: runtimeVersionMeta.buildNumber,
        sdkVersion: runtimeVersionMeta.sdkVersion,
      }));

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
    const message = resolvedMessage ?? "Embedded baseline via better-update CLI";

    const launchAsset = yield* prepareEmbeddedLaunchAsset({
      api,
      assetUploader,
      projectId,
      bundlePath,
    });

    const update = yield* api.updates
      .create({
        payload: {
          // Pin the baseline id to the binary's app.manifest UUID (NOT a
          // server-minted id), so the device's expo-embedded-update-id matches
          // this row's id when first-launch patches resolve. randomUUID below is
          // ONLY the groupId.
          id: embeddedId,
          branch,
          slug,
          runtimeVersion,
          platform: options.platform,
          message,
          groupId: randomUUID(),
          metadata: {},
          extra: {
            expoClient: expoClientConfig,
            eas: { projectId },
            environment: options.environment,
          },
          assets: [
            {
              hash: launchAsset.hash,
              key: launchAsset.key,
              isLaunch: true,
              contentChecksum: launchAsset.contentChecksum,
            },
          ],
          isEmbedded: true,
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new UpdatePublishError({
              message: `Failed to register embedded update: ${formatCause(cause)}`,
            }),
        ),
      );

    return {
      updateId: update.id,
      branch,
      platform: options.platform,
      runtimeVersion,
      launchAssetHash: launchAsset.hash,
      reused: launchAsset.reused,
    } as const satisfies EmbeddedUploadResult;
  });

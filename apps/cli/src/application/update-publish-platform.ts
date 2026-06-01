import { randomUUID } from "node:crypto";

import { fromHex, toBase64Url } from "@better-update/encoding";
import { deriveScopeKey } from "@better-update/expo-protocol";
import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { uniqBy } from "es-toolkit";

import type { ManifestAssetData } from "@better-update/expo-protocol";
import type { CommandExecutor, FileSystem } from "@effect/platform";

import { readRuntimeVersionMeta } from "../lib/build-profile";
import { UpdatePublishError } from "../lib/exit-codes";
import { readExpoExportAssets, runExpoExport } from "../lib/expo-export";
import { runFingerprintForPlatform } from "../lib/fingerprint";
import { formatCause } from "../lib/format-error";
import { printHuman } from "../lib/output";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { sha256File, sha256Namespaced } from "../lib/sha256";
import {
  assertSignedManifestBundleUrl,
  buildSignedPayloadFromRender,
} from "../lib/signed-payloads";
import { apiClient } from "../services/api-client";
import { ConfigStore } from "../services/config-store";
import { UpdateAssetUploader } from "../services/update-asset-uploader";
import { runPatchPhase } from "./update-patch-phase";

import type { Platform } from "../lib/build-profile";
import type {
  AuthRequiredError,
  BuildFailedError,
  BuildProfileError,
  RuntimeVersionError,
} from "../lib/exit-codes";
import type { ExpoConfig } from "../lib/expo-config";
import type { GitContext } from "../lib/git-context";
import type { OutputMode } from "../lib/output-mode";
import type { SignedPayload } from "../lib/signed-payloads";
import type { ApiClientService } from "../services/api-client";
import type { BsdiffService } from "../services/bsdiff";
import type { CliRuntime } from "../services/cli-runtime";
import type { PatchUploader } from "../services/patch-uploader";
import type { PresignedDownloadClient } from "../services/presigned-download";
import type { PatchPhaseResult } from "./update-patch-phase";

export interface PublishedPlatformResult {
  readonly platform: Platform;
  readonly updateId: string;
  readonly runtimeVersion: string;
  readonly uploadedAssets: number;
  readonly deduplicatedAssets: number;
  /**
   * Outcome of the best-effort bsdiff patch phase. `null` when patches were
   * skipped entirely (`--no-patches`, no launch asset, or the phase failed and
   * was swallowed). Surfaced in the publish output so attempted/uploaded/skipped
   * are visible rather than silently discarded.
   */
  readonly patches: PatchPhaseResult | null;
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

// `scopeKey` is appended LAST and omitted (via compact) when undefined so the
// JSON field order stays deterministic and the no-updates-url case is byte-for-
// byte identical to the previous {expoClient, eas, environment} shape. The device
// reads extra.scopeKey only when a code-signing certificate carries the Expo-
// project-information extension; emitting the device-derived origin keeps that
// cross-check from throwing (iOS) / rejecting the update (Android).
const buildUpdateExtra = (
  expoClient: Record<string, unknown>,
  projectId: string,
  environment: string,
  scopeKey: string | undefined,
) =>
  compact({
    expoClient,
    eas: { projectId },
    environment,
    scopeKey,
  });

// Match the device's `config.scopeKey = EXUpdatesScopeKey ?? normalizedURLOrigin(
// updates.url)`. Returns undefined (=> scopeKey omitted) when updates are not
// configured, so we never emit a wrong origin the cert cross-check would reject.
const resolveManifestScopeKey = (expoConfig: ExpoConfig): string | undefined => {
  const updatesConfig = expoConfig.updates;
  const explicit = updatesConfig?.["scopeKey"];
  const explicitScopeKey = typeof explicit === "string" && explicit ? explicit : undefined;
  if (explicitScopeKey !== undefined) {
    return explicitScopeKey;
  }
  return updatesConfig?.url ? deriveScopeKey({ updateUrl: updatesConfig.url }) : undefined;
};

/**
 * Map the (best-effort) git context onto the create-body git fields. Always
 * emits `gitDirty` (false == clean tree); emits `gitCommit` only when git
 * resolved a HEAD SHA (omitted via compact on a non-git project / empty repo).
 * Mirrors EAS gitCommitHash + isGitWorkingTreeDirty and the builds path — sent
 * ALWAYS, not gated on --auto. Pure + colocated so the "no commit → omit, dirty
 * false" gap is directly testable without standing up the whole publish.
 */
export const gitCreateFields = (
  git: GitContext,
): { readonly gitDirty: boolean; readonly gitCommit?: string } => ({
  gitDirty: git.dirty,
  ...compact({ gitCommit: git.commit }),
});

const dedupeAssetsByHash = (assets: readonly PreparedAsset[]): readonly PreparedAsset[] =>
  uniqBy(assets, (asset) => asset.hash);

/**
 * Record the per-platform fingerprint (matching EAS) so `fingerprint:compare`
 * lines up with the per-platform `fingerprint`-policy RTV. Best-effort: the hash
 * is informational, so a fingerprint failure resolves to `undefined` rather than
 * failing the publish.
 */
const resolvePlatformFingerprintHash = (
  projectRoot: string,
  platform: Platform,
): Effect.Effect<
  string | undefined,
  never,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem
> =>
  runFingerprintForPlatform(projectRoot, platform).pipe(
    Effect.map((result) => result.hash),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );

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

/**
 * Code-signing input for the render+sign publish path. Carries the developer's
 * RSA private key + certificate chain (both PEM) and the keyid + server origin
 * needed to render the launch bundle URL. When present, `publishPlatform`
 * generates a client-side update id, renders the manifest with the Worker bundle
 * URL, signs it, and sends `{id, manifestBody, signature, certificateChain}` —
 * mutually exclusive with the file-based `signedPayload`.
 */
export interface CodeSigningInput {
  readonly privateKeyPem: string;
  readonly certificateChainPem: string;
  readonly keyid: string;
  readonly serverBaseUrl: string;
}

export interface PublishPlatformParams {
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
  readonly codeSigning: CodeSigningInput | null;
  readonly rolloutPercentage: number | undefined;
  readonly skipBundler: boolean;
  readonly noBytecode: boolean;
  readonly sourceMaps: boolean;
  readonly patchBaseWindow: number;
  readonly noPatches: boolean;
  readonly patchWorkDir: string;
  /**
   * Git provenance read once upstream (update-publish.ts → readGitContext).
   * The HEAD SHA + dirty flag persist on the created update (mirrors EAS
   * gitCommitHash + isGitWorkingTreeDirty, and the builds path). Sent ALWAYS
   * when git is readable — NOT gated on --auto. `commit` is undefined when the
   * project root is not a git repo / detached HEAD with no commits.
   */
  readonly gitContext: GitContext;
}

export const publishPlatform = (
  params: PublishPlatformParams,
): Effect.Effect<
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
  | BsdiffService
  | PatchUploader
  | PresignedDownloadClient
  | ConfigStore
  | OutputMode
> =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const assetUploader = yield* UpdateAssetUploader;

    const runtimeVersionMeta = readRuntimeVersionMeta(params.expoConfig, params.platform);
    // Resolve the RTV and the (best-effort) per-platform fingerprint together —
    // both are platform-scoped and independent, so running them concurrently
    // keeps `publishPlatform` to a single statement here.
    const [runtimeVersion, fingerprintHash] = yield* Effect.all(
      [
        resolveRuntimeVersion({
          raw: runtimeVersionMeta.rawRuntimeVersion,
          appVersion: runtimeVersionMeta.appVersion,
          projectRoot: params.projectRoot,
          platform: params.platform,
          buildNumber: runtimeVersionMeta.buildNumber,
          sdkVersion: runtimeVersionMeta.sdkVersion,
        }),
        resolvePlatformFingerprintHash(params.projectRoot, params.platform),
      ],
      { concurrency: 2 },
    );

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

    const configStore = yield* ConfigStore;
    // serverBaseUrl routes the launch bundle to the Worker (bsdiff negotiation).
    // assetCdnUrl is the CDN origin that serves non-launch assets — the deployed
    // Worker has no `/assets/{hash}` route on the API origin, and the signed
    // manifestBody is served verbatim, so its regular-asset URLs must already
    // point at the CDN or they fail to load on-device.
    const [serverBaseUrl, assetCdnUrl] = yield* Effect.all(
      [configStore.getBaseUrl, configStore.getAssetCdnUrl],
      { concurrency: "unbounded" },
    );

    // The manifest metadata + extra MUST match what is sent to the server, since
    // the server stores + serves the signed manifestBody verbatim. Compute them
    // once here so both the render and the create body agree.
    const manifestMetadata: Record<string, unknown> = {};
    const manifestExtra = buildUpdateExtra(
      params.expoClientConfig,
      params.projectId,
      params.environment,
      resolveManifestScopeKey(params.expoConfig),
    );

    // Render-then-sign requires the manifest id (it keys launchAsset.url + the
    // manifest's own `id`) BEFORE signing, so we generate it client-side and the
    // server persists THIS id (`payload.id`). Both the id and the payload come out
    // of one branch so their presence is linked. Only allocated for the signing
    // path; null otherwise (unsigned or file escape-hatch).
    const { codeSigning } = params;
    const rendered = codeSigning
      ? yield* Effect.gen(function* () {
          const id = randomUUID();
          const payload = yield* buildSignedPayloadFromRender({
            update: {
              id,
              createdAt: new Date().toISOString(),
              runtimeVersion,
              metadata: manifestMetadata,
              extra: manifestExtra,
            },
            assets: preparedAssets.map(
              (asset): ManifestAssetData => ({
                key: asset.key,
                hash: asset.hash,
                contentChecksum: asset.contentChecksum,
                contentType: asset.contentType,
                fileExt: asset.fileExt,
                isLaunch: asset.isLaunch,
              }),
            ),
            assetBaseUrl: assetCdnUrl,
            serverBaseUrl,
            projectId: params.projectId,
            codeSigning: {
              privateKeyPem: codeSigning.privateKeyPem,
              certificateChainPem: codeSigning.certificateChainPem,
              keyid: codeSigning.keyid,
            },
          });
          return { id, payload } as const;
        })
      : null;

    const clientUpdateId = rendered?.id;
    // The effective signed payload is the rendered one (preferred) or the
    // file-loaded one (escape hatch). They are mutually exclusive (enforced
    // upstream in update-publish.ts).
    const effectiveSignedPayload = rendered?.payload ?? params.signedPayload;

    // Gap D: a signed manifestBody is served verbatim, so its launchAsset.url
    // must already point at the Worker bundle route for patches to apply. The
    // render path passes trivially; the file path still needs the assert.
    if (effectiveSignedPayload) {
      yield* assertSignedManifestBundleUrl({
        manifestBody: effectiveSignedPayload.manifestBody,
        serverBaseUrl,
        projectId: params.projectId,
        platform: params.platform,
        makeError: (message) => new UpdatePublishError({ message }),
      });
    }

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
          metadata: manifestMetadata,
          extra: manifestExtra,
          assets: preparedAssets.map((asset) => ({
            hash: asset.hash,
            key: asset.key,
            isLaunch: asset.isLaunch,
            contentChecksum: asset.contentChecksum,
          })),
          // Bind the client-chosen id so the served row id == the signed
          // manifest id == the bundle-route id (render+sign path only).
          ...(clientUpdateId === undefined ? {} : { id: clientUpdateId }),
          ...(effectiveSignedPayload
            ? {
                manifestBody: effectiveSignedPayload.manifestBody,
                signature: effectiveSignedPayload.signature,
                certificateChain: effectiveSignedPayload.certificateChain,
              }
            : {}),
          // Git provenance — always sends the dirty flag; commit only when git
          // resolved a HEAD SHA. Mirrors EAS + the builds path; NOT --auto-gated.
          ...gitCreateFields(params.gitContext),
          ...compact({
            rolloutPercentage: params.rolloutPercentage,
            fingerprintHash,
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

    const launchAsset = preparedAssets.find((asset) => asset.isLaunch);
    // Best-effort: bsdiff patches are an optimization. The full bundle is always
    // served on a patch miss, so a patch failure must never fail the publish
    // (mirrors runFingerprintFull). Errors are logged + swallowed → result null.
    const patches =
      params.noPatches || !launchAsset
        ? null
        : yield* runPatchPhase({
            projectId: params.projectId,
            branch: params.branch,
            runtimeVersion,
            platform: params.platform,
            newUpdateId: update.id,
            newLaunchPath: launchAsset.path,
            workDir: params.patchWorkDir,
            baseWindow: params.patchBaseWindow,
            concurrency: 2,
          }).pipe(
            Effect.catchAll((cause) =>
              printHuman(
                `Patch generation skipped for ${params.platform}: ${formatCause(cause)}`,
              ).pipe(Effect.as(null)),
            ),
          );

    return {
      platform: params.platform,
      updateId: update.id,
      runtimeVersion,
      uploadedAssets: assetRegistration.uploaded.length,
      deduplicatedAssets: assetRegistration.deduplicated.length,
      patches,
    } as const satisfies PublishedPlatformResult;
  });

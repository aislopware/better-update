import { randomUUID } from "node:crypto";
import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { CommandExecutor } from "@effect/platform";

import { pullEnvVars } from "../lib/env-exporter";
import { UpdatePublishError } from "../lib/exit-codes";
import {
  extractCodeSigningConfig,
  extractProjectId,
  extractSlug,
  readExpoConfig,
} from "../lib/expo-config";
import { readExpoPublicConfig } from "../lib/expo-export";
import { formatCause } from "../lib/format-error";
import { readGitContext } from "../lib/git-context";
import { InteractiveMode } from "../lib/interactive-mode";
import { ensureRepoClean } from "../lib/repo-clean";
import { loadSignedPublishPayloads } from "../lib/signed-payloads";
import { acquireBuildTempDir } from "../lib/temp-dir";
import { resolveUpdatePlatforms } from "../lib/update-platforms";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { ConfigStore } from "../services/config-store";
import {
  confirmPublishPreview,
  emitMetadataFile,
  resolveBranchAndMessage,
} from "./update-publish-helpers";
import { publishPlatform } from "./update-publish-platform";

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
import type { OutputMode } from "../lib/output-mode";
import type { ApiClientService } from "../services/api-client";
import type { BsdiffService } from "../services/bsdiff";
import type { IdentityStore } from "../services/identity-store";
import type { PatchUploader } from "../services/patch-uploader";
import type { PresignedDownloadClient } from "../services/presigned-download";
import type { UpdateAssetUploader } from "../services/update-asset-uploader";
import type { CodeSigningInput, PublishedPlatformResult } from "./update-publish-platform";

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
  // Path to the RSA private key (PEM) used to render + code-sign the manifest.
  // Mutually exclusive with the file escape-hatch options above; the render path
  // is preferred (it emits the Worker bundle URL so signed updates get bsdiff).
  readonly privateKeyPath: string | undefined;
  readonly patchBaseWindow: number;
  readonly noPatches: boolean;
}

export interface PublishUpdatesResult {
  readonly groupId: string;
  readonly branch: string;
  readonly results: readonly PublishedPlatformResult[];
}

// Whether ANY of the file-input escape-hatch options is set. The render path
// (--private-key-path) is mutually exclusive with all of them.
const hasAnySignedFileOption = (options: RunUpdatePublishOptions): boolean =>
  options.manifestBodyFile !== undefined ||
  options.signatureFile !== undefined ||
  options.certificateChainFile !== undefined ||
  options.manifestBodyFileIos !== undefined ||
  options.signatureFileIos !== undefined ||
  options.certificateChainFileIos !== undefined ||
  options.manifestBodyFileAndroid !== undefined ||
  options.signatureFileAndroid !== undefined ||
  options.certificateChainFileAndroid !== undefined;

// Resolve the render+sign code-signing input from --private-key-path + the
// app.json codeSigningCertificate/codeSigningMetadata. Returns null when no
// private key was passed (unsigned, or file escape-hatch path).
const resolveCodeSigning = (params: {
  readonly privateKeyPath: string | undefined;
  readonly anyFileOption: boolean;
  readonly projectRoot: string;
  readonly expoConfig: ExpoConfig;
  readonly serverBaseUrl: string;
}): Effect.Effect<CodeSigningInput | null, UpdatePublishError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (params.privateKeyPath === undefined) {
      return null;
    }
    if (params.anyFileOption) {
      return yield* new UpdatePublishError({
        message:
          "--private-key-path cannot be combined with the --*-file signed-input options. Use one signing path or the other.",
      });
    }

    const codeSigning = yield* extractCodeSigningConfig(params.expoConfig);
    if (codeSigning === undefined) {
      return yield* new UpdatePublishError({
        message:
          "--private-key-path was provided but updates.codeSigningCertificate is not set in your Expo config. Add the certificate path to app.json.",
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const certificateAbsolutePath = path.resolve(params.projectRoot, codeSigning.certificatePath);
    const [privateKeyPem, certificateChainPem] = yield* Effect.all(
      [
        fileSystem.readFileString(params.privateKeyPath),
        fileSystem.readFileString(certificateAbsolutePath),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new UpdatePublishError({
            message: `Failed to read code-signing key/certificate: ${formatCause(cause)}`,
          }),
      ),
    );

    return {
      privateKeyPem,
      certificateChainPem,
      keyid: codeSigning.keyid,
      serverBaseUrl: params.serverBaseUrl,
    } satisfies CodeSigningInput;
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
  | BsdiffService
  | PatchUploader
  | PresignedDownloadClient
  | ConfigStore
  | OutputMode
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

      // Render+sign path: when --private-key-path is set, read the code-signing
      // config from app.json, load the cert + private key PEM, and build the
      // signing input. Mutually exclusive with the file escape-hatch options.
      const configStore = yield* ConfigStore;
      const codeSigningServerBaseUrl = yield* configStore.getBaseUrl;
      const codeSigning = yield* resolveCodeSigning({
        privateKeyPath: options.privateKeyPath,
        anyFileOption: hasAnySignedFileOption(options),
        projectRoot,
        expoConfig,
        serverBaseUrl: codeSigningServerBaseUrl,
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
            codeSigning,
            rolloutPercentage: options.rolloutPercentage,
            skipBundler: options.skipBundler,
            noBytecode: options.noBytecode,
            sourceMaps: options.sourceMaps,
            patchBaseWindow: options.patchBaseWindow,
            noPatches: options.noPatches,
            patchWorkDir: path.join(tempDir, `patches-${platform}`),
            // Reuse the git context already read once above (line ~232). Both
            // commit + dirty persist on the created update (mirrors EAS + the
            // builds path); branch/message derivation already consumed gitCtx
            // via resolveBranchAndMessage.
            gitContext: gitCtx,
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

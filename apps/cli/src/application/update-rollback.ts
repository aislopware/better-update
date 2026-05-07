import { randomUUID } from "node:crypto";

import { buildRollbackDirectiveBody } from "@better-update/expo-protocol";
import { isRecord } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { CommandExecutor } from "@effect/platform";

import { readRuntimeVersionMeta } from "../lib/build-profile";
import { pullEnvVars } from "../lib/env-exporter";
import { UpdateRollbackError } from "../lib/exit-codes";
import { extractProjectId, extractSlug, readExpoConfig } from "../lib/expo-config";
import { formatCause } from "../lib/format-error";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { resolveUpdatePlatforms } from "../lib/update-platforms";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";

import type { Platform } from "../lib/build-profile";
import type {
  AuthRequiredError,
  BuildProfileError,
  EnvExportError,
  ProjectNotLinkedError,
  RuntimeVersionError,
} from "../lib/exit-codes";
import type { UpdatePlatformOption } from "../lib/update-platforms";
import type { ApiClientService } from "../services/api-client";

interface CreateRollbackParams {
  readonly branch: string;
  readonly projectSlug: string;
  readonly runtimeVersion: string;
  readonly platform: Platform;
  readonly message: string;
  readonly groupId: string;
  readonly directiveBody: string;
  readonly signature: string | undefined;
  readonly certificateChain: string | undefined;
}

export interface RollbackResultItem {
  readonly platform: Platform;
  readonly updateId: string;
  readonly runtimeVersion: string;
}

export interface RunUpdateRollbackOptions {
  readonly branch: string;
  readonly platform: UpdatePlatformOption;
  readonly environment: string;
  readonly message: string | undefined;
  readonly commitTime: string | undefined;
  readonly directiveBodyFile: string | undefined;
  readonly signatureFile: string | undefined;
  readonly certificateChainFile: string | undefined;
}

export interface UpdateRollbackResult {
  readonly groupId: string;
  readonly branch: string;
  readonly commitTime: string;
  readonly results: readonly RollbackResultItem[];
}

interface SignedRollbackPayload {
  readonly directiveBody: string;
  readonly signature: string;
  readonly certificateChain: string;
}

const resolveCommitTime = (input: string | undefined): Effect.Effect<string, UpdateRollbackError> =>
  Effect.gen(function* () {
    const commitTime = input ?? new Date().toISOString();
    if (Number.isNaN(Date.parse(commitTime))) {
      return yield* new UpdateRollbackError({
        message: "commitTime must be a valid ISO 8601 timestamp.",
      });
    }
    return commitTime;
  });

const extractDirectiveCommitTime = (
  directiveBody: string,
): Effect.Effect<string, UpdateRollbackError> =>
  Effect.gen(function* () {
    const directive = yield* Effect.try({
      try: (): unknown => JSON.parse(directiveBody),
      catch: () =>
        new UpdateRollbackError({
          message: "directiveBody must be valid JSON.",
        }),
    });

    if (!isRecord(directive)) {
      return yield* new UpdateRollbackError({
        message: "directiveBody must decode to a JSON object.",
      });
    }

    if (directive["type"] !== "rollBackToEmbedded") {
      return yield* new UpdateRollbackError({
        message: 'directiveBody.type must be "rollBackToEmbedded".',
      });
    }

    const { parameters } = directive;
    if (!isRecord(parameters)) {
      return yield* new UpdateRollbackError({
        message: "directiveBody.parameters must be an object.",
      });
    }

    const { commitTime } = parameters;
    if (typeof commitTime !== "string" || Number.isNaN(Date.parse(commitTime))) {
      return yield* new UpdateRollbackError({
        message: "directiveBody.parameters.commitTime must be a valid ISO 8601 timestamp.",
      });
    }

    return commitTime;
  });

const loadOptionalSignedRollbackPayload = (
  options: RunUpdateRollbackOptions,
): Effect.Effect<SignedRollbackPayload | null, UpdateRollbackError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const hasAnySigningInput =
      options.directiveBodyFile !== undefined ||
      options.signatureFile !== undefined ||
      options.certificateChainFile !== undefined;

    if (!hasAnySigningInput) {
      return null;
    }

    if (!options.directiveBodyFile || !options.signatureFile || !options.certificateChainFile) {
      return yield* new UpdateRollbackError({
        message:
          "Signed rollback requires --directive-body-file, --signature-file, and --certificate-chain-file together.",
      });
    }

    const [directiveBody, signature, certificateChain] = yield* Effect.all(
      [
        fileSystem.readFileString(options.directiveBodyFile),
        fileSystem.readFileString(options.signatureFile),
        fileSystem.readFileString(options.certificateChainFile),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new UpdateRollbackError({
            message: `Failed to read signed rollback inputs: ${formatCause(cause)}`,
          }),
      ),
    );

    return {
      directiveBody,
      signature: signature.trim(),
      certificateChain: certificateChain.trimEnd(),
    } satisfies SignedRollbackPayload;
  });

const createRollbackForPlatform = (
  params: CreateRollbackParams,
): Effect.Effect<RollbackResultItem, AuthRequiredError | UpdateRollbackError, ApiClientService> =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const update = yield* api.updates
      .create({
        payload: {
          branch: params.branch,
          slug: params.projectSlug,
          runtimeVersion: params.runtimeVersion,
          platform: params.platform,
          message: params.message,
          groupId: params.groupId,
          metadata: {},
          assets: [],
          isRollback: true,
          directiveBody: params.directiveBody,
          ...(params.signature ? { signature: params.signature } : {}),
          ...(params.certificateChain ? { certificateChain: params.certificateChain } : {}),
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new UpdateRollbackError({
              message: `Failed to create ${params.platform} rollback: ${formatCause(cause)}`,
            }),
        ),
      );

    return {
      platform: params.platform,
      updateId: update.id,
      runtimeVersion: params.runtimeVersion,
    } as const satisfies RollbackResultItem;
  });

export const runUpdateRollback = (
  options: RunUpdateRollbackOptions,
): Effect.Effect<
  UpdateRollbackResult,
  | AuthRequiredError
  | ProjectNotLinkedError
  | BuildProfileError
  | EnvExportError
  | RuntimeVersionError
  | UpdateRollbackError,
  ApiClientService | CliRuntime | CommandExecutor.CommandExecutor | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const projectRoot = yield* runtime.cwd;
    const api = yield* apiClient;

    const baseConfig = yield* readExpoConfig(projectRoot);
    const projectId = yield* extractProjectId(baseConfig);

    const environmentVars = yield* pullEnvVars(api, {
      projectId,
      environment: options.environment,
    });

    // Re-resolve with the env-var overlay so runtimeVersion / ios / android
    // sections (and slug) derived from process.env match what the corresponding
    // publish would have computed — otherwise rollback can target the wrong
    // runtime or publish under a stale slug.
    const config = yield* readExpoConfig(projectRoot, environmentVars);
    const projectSlug = yield* extractSlug(config);
    const platforms = resolveUpdatePlatforms(config, options.platform);
    if (platforms.length === 0) {
      return yield* new UpdateRollbackError({
        message:
          'No publishable platforms found in your Expo config. Add an "ios" or "android" section, or pass --platform explicitly.',
      });
    }

    const { appVersion, rawRuntimeVersion } = readRuntimeVersionMeta(config);
    const runtimeVersion = yield* resolveRuntimeVersion({
      raw: rawRuntimeVersion,
      appVersion,
      projectRoot,
    });
    const signedPayload = yield* loadOptionalSignedRollbackPayload(options);
    const commitTime = signedPayload
      ? yield* Effect.gen(function* () {
          const directiveCommitTime = yield* extractDirectiveCommitTime(
            signedPayload.directiveBody,
          );
          if (options.commitTime && options.commitTime !== directiveCommitTime) {
            return yield* new UpdateRollbackError({
              message: "commitTime must match directiveBody.parameters.commitTime in signed mode.",
            });
          }
          return directiveCommitTime;
        })
      : yield* resolveCommitTime(options.commitTime);
    const groupId = randomUUID();
    const message = options.message ?? "Rollback to embedded via better-update CLI";

    const results = yield* Effect.forEach(
      platforms,
      (platform) =>
        createRollbackForPlatform({
          branch: options.branch,
          projectSlug,
          runtimeVersion,
          platform,
          message,
          groupId,
          directiveBody: signedPayload?.directiveBody ?? buildRollbackDirectiveBody(commitTime),
          signature: signedPayload?.signature,
          certificateChain: signedPayload?.certificateChain,
        }),
      { concurrency: 1 },
    );

    return {
      groupId,
      branch: options.branch,
      commitTime,
      results,
    } as const satisfies UpdateRollbackResult;
  });

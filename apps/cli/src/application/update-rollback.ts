import { randomUUID } from "node:crypto";

import { CommandExecutor, FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { readAppJson, readProjectId, readScopeKey } from "../lib/app-json";
import { readRuntimeVersionMeta, type Platform } from "../lib/build-profile";
import {
  AuthRequiredError,
  BuildProfileError,
  ProjectNotLinkedError,
  RuntimeVersionError,
  UpdateRollbackError,
} from "../lib/exit-codes";
import { buildRollbackDirectiveBody } from "../lib/rollback-directive";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { resolveUpdatePlatforms, type UpdatePlatformOption } from "../lib/update-platforms";
import { ApiClientService, apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";

const formatCause = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === "object" && cause !== null) {
    const tagged = cause as { readonly _tag?: unknown; readonly message?: unknown };
    const tag = typeof tagged._tag === "string" ? tagged._tag : undefined;
    const message = typeof tagged.message === "string" ? tagged.message : undefined;
    if (tag && message) {
      return `${tag}: ${message}`;
    }
    if (message) {
      return message;
    }
    if (tag) {
      return tag;
    }
  }

  return String(cause);
};

interface CreateRollbackParams {
  readonly branch: string;
  readonly projectScopeKey: string;
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
      try: () => JSON.parse(directiveBody) as unknown,
      catch: () =>
        new UpdateRollbackError({
          message: "directiveBody must be valid JSON.",
        }),
    });

    if (typeof directive !== "object" || directive === null) {
      return yield* new UpdateRollbackError({
        message: "directiveBody must decode to a JSON object.",
      });
    }

    const type = Reflect.get(directive, "type");
    if (type !== "rollBackToEmbedded") {
      return yield* new UpdateRollbackError({
        message: 'directiveBody.type must be "rollBackToEmbedded".',
      });
    }

    const parameters = Reflect.get(directive, "parameters");
    if (typeof parameters !== "object" || parameters === null) {
      return yield* new UpdateRollbackError({
        message: "directiveBody.parameters must be an object.",
      });
    }

    const commitTime = Reflect.get(parameters, "commitTime");
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
          project: params.projectScopeKey,
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
  | RuntimeVersionError
  | UpdateRollbackError,
  ApiClientService | CliRuntime | CommandExecutor.CommandExecutor | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const projectRoot = yield* runtime.cwd;
    yield* readProjectId;
    const projectScopeKey = yield* readScopeKey;
    const appJson = yield* readAppJson;
    const platforms = resolveUpdatePlatforms(appJson, options.platform);
    if (platforms.length === 0) {
      return yield* new UpdateRollbackError({
        message:
          'No publishable platforms found in app.json. Add an "expo.ios" or "expo.android" section, or pass --platform explicitly.',
      });
    }

    const { appVersion, rawRuntimeVersion } = yield* readRuntimeVersionMeta(appJson);
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
          projectScopeKey,
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

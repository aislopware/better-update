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
  readonly commitTime: string;
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
}

export interface UpdateRollbackResult {
  readonly groupId: string;
  readonly branch: string;
  readonly commitTime: string;
  readonly results: readonly RollbackResultItem[];
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
          directiveBody: buildRollbackDirectiveBody(params.commitTime),
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
    const commitTime = yield* resolveCommitTime(options.commitTime);
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
          commitTime,
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

import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { UpdatePublishError } from "../lib/exit-codes";
import { formatCause } from "../lib/format-error";

import type { Platform } from "../lib/build-profile";
import type { apiClient } from "../services/api-client";

export interface PublishedPlatformMetadata {
  readonly platform: Platform;
  readonly updateId: string;
  readonly runtimeVersion: string;
}

export const resolveChannelToBranch = (
  client: Effect.Effect.Success<typeof apiClient>,
  projectId: string,
  channelName: string,
) =>
  Effect.gen(function* () {
    const channels = yield* client.channels.list({ urlParams: { projectId, limit: 100 } }).pipe(
      Effect.mapError(
        (cause) =>
          new UpdatePublishError({
            message: `Failed to list channels: ${formatCause(cause)}`,
          }),
      ),
    );
    const match = channels.items.find((channel) => channel.name === channelName);
    if (!match) {
      return yield* new UpdatePublishError({
        message: `Channel "${channelName}" not found.`,
      });
    }
    const branches = yield* client.branches.list({ urlParams: { projectId, limit: 100 } }).pipe(
      Effect.mapError(
        (cause) =>
          new UpdatePublishError({
            message: `Failed to list branches: ${formatCause(cause)}`,
          }),
      ),
    );
    const branch = branches.items.find((entry) => entry.id === match.branchId);
    if (!branch) {
      return yield* new UpdatePublishError({
        message: `Channel "${channelName}" maps to a branch (${match.branchId}) not in the project's branch list.`,
      });
    }
    return branch.name;
  });

export const emitMetadataFile = (input: {
  readonly dir: string;
  readonly groupId: string;
  readonly branch: string;
  readonly channel: string | undefined;
  readonly message: string;
  readonly results: readonly PublishedPlatformMetadata[];
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(input.dir, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new UpdatePublishError({
            message: `Failed to prepare metadata directory: ${formatCause(cause)}`,
          }),
      ),
    );
    const metadata = {
      groupId: input.groupId,
      branch: input.branch,
      ...(input.channel === undefined ? {} : { channel: input.channel }),
      message: input.message,
      updates: input.results.map((entry) => ({
        platform: entry.platform,
        updateId: entry.updateId,
        runtimeVersion: entry.runtimeVersion,
      })),
    };
    const filePath = path.join(input.dir, "eas-update-metadata.json");
    yield* fs.writeFileString(filePath, `${JSON.stringify(metadata, null, 2)}\n`).pipe(
      Effect.mapError(
        (cause) =>
          new UpdatePublishError({
            message: `Failed to write ${filePath}: ${formatCause(cause)}`,
          }),
      ),
    );
  });

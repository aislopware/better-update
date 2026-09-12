import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { drainPages } from "../../lib/drain-cursor";
import { printHuman } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { UpdateCommandError } from "./helpers";

export const revertRolloutCommand = Command.make(
  "revert-rollout",
  {
    groupId: Argument.String("groupId").pipe(Argument.withDescription("Update group ID")),
  },
  Effect.fn(function* (args) {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const allUpdates = yield* drainPages((page) =>
      api.updates.list({ query: { projectId, limit: 100, page } }),
    );
    const inGroup = allUpdates.filter((update) => update.groupId === args.groupId);
    if (inGroup.length === 0) {
      return yield* new UpdateCommandError({
        message: `No updates found for group ${args.groupId}.`,
      });
    }

    yield* Effect.forEach(
      inGroup,
      (update) => api.updates.revertRollout({ params: { id: update.id } }),
      { concurrency: 2 },
    );

    yield* printHuman(
      `Reverted rollout for ${String(inGroup.length)} update(s) in group ${args.groupId}.`,
    );
    return undefined;
  }, runCommand()),
).pipe(Command.withDescription("Revert in-progress rollout for every update in a group"));

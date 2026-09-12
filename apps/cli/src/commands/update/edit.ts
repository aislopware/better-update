import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { parseRolloutPercentage } from "../../lib/cli-schemas";
import { drainPages } from "../../lib/drain-cursor";
import { printHuman } from "../../lib/output";
import { optionalArgument, optionalFlag } from "../../lib/params";
import { readProjectId } from "../../lib/project-link";
import { promptSelect, promptText } from "../../lib/prompts";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { resolveNamedResourceId, UpdateCommandError } from "./helpers";

import type { ApiClient } from "../../services/api-client";

const promptGroupId = (api: ApiClient, projectId: string, branchName: string | undefined) =>
  Effect.gen(function* () {
    const branches = yield* drainPages((page) =>
      api.branches.list({ query: { projectId, limit: 100, page } }),
    );
    const branchId = branchName
      ? yield* resolveNamedResourceId({ items: branches, kind: "Branch", name: branchName })
      : undefined;
    const { items } = yield* api.updates.list({
      query: {
        projectId,
        limit: 50,
        ...compact({ branchId: branchId ? [branchId] : undefined }),
      },
    });
    const groups = new Map<string, { readonly groupId: string; readonly message: string | null }>();
    for (const update of items) {
      if (!groups.has(update.groupId)) {
        groups.set(update.groupId, { groupId: update.groupId, message: update.message });
      }
    }
    if (groups.size === 0) {
      return yield* new UpdateCommandError({
        message: "No update groups found to edit.",
      });
    }
    return yield* promptSelect<string>(
      "Select an update group",
      [...groups.values()].map((group) => ({
        value: group.groupId,
        label: `${group.groupId} — ${group.message ?? "(no message)"}`,
      })),
    );
  });

export const editCommand = Command.make(
  "edit",
  {
    groupId: Argument.String("groupId").pipe(
      Argument.withDescription("Update group ID"),
      optionalArgument,
    ),
    branch: Flag.String("branch").pipe(
      Flag.withDescription("Filter interactive group selection to a single branch"),
      optionalFlag,
    ),
    "rollout-percentage": Flag.String("rollout-percentage").pipe(
      Flag.withDescription("New rollout percentage (1-100)"),
      optionalFlag,
    ),
  },
  Effect.fn(function* (args) {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const groupId = args.groupId ?? (yield* promptGroupId(api, projectId, args.branch));

    const rolloutRaw =
      args["rollout-percentage"] ?? (yield* promptText("New rollout percentage (1-100)"));
    const percentage = yield* parseRolloutPercentage(rolloutRaw, "rollout-percentage");

    const allUpdates = yield* drainPages((page) =>
      api.updates.list({ query: { projectId, limit: 100, page } }),
    );
    const inGroup = allUpdates.filter((update) => update.groupId === groupId);
    if (inGroup.length === 0) {
      return yield* new UpdateCommandError({
        message: `No updates found for group ${groupId}.`,
      });
    }

    yield* Effect.forEach(
      inGroup,
      (update) =>
        api.updates.editRollout({
          params: { id: update.id },
          payload: { percentage },
        }),
      { concurrency: 2 },
    );

    yield* printHuman(
      `Set rollout to ${String(percentage)}% for ${String(inGroup.length)} update(s) in group ${groupId}.`,
    );
    return undefined;
  }, runCommand()),
).pipe(Command.withDescription("Edit rollout percentage for every update in a group"));

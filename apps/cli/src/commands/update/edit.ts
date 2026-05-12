import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { parseRolloutPercentage } from "../../lib/cli-schemas";
import { drainPages } from "../../lib/drain-cursor";
import { readProjectId } from "../../lib/expo-config";
import { printHuman } from "../../lib/output";
import { promptSelect, promptText } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";
import { resolveNamedResourceId, UpdateCommandError, updateErrorExtras } from "./helpers";

import type { ApiClient } from "../../services/api-client";

const promptGroupId = (api: ApiClient, projectId: string, branchName: string | undefined) =>
  Effect.gen(function* () {
    const branches = yield* drainPages((page) =>
      api.branches.list({ urlParams: { projectId, limit: 100, page } }),
    );
    const branchId = branchName
      ? yield* resolveNamedResourceId({ items: branches, kind: "Branch", name: branchName })
      : undefined;
    const { items } = yield* api.updates.list({
      urlParams: {
        projectId,
        ...(branchId === undefined ? {} : { branchId }),
        limit: 50,
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

export const editCommand = defineCommand({
  meta: {
    name: "edit",
    description: "Edit rollout percentage for every update in a group",
  },
  args: {
    groupId: { type: "positional", required: false, description: "Update group ID" },
    branch: {
      type: "string",
      description: "Filter interactive group selection to a single branch",
    },
    "rollout-percentage": {
      type: "string",
      description: "New rollout percentage (1-100)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const groupId = args.groupId ?? (yield* promptGroupId(api, projectId, args.branch));

        const rolloutRaw =
          args["rollout-percentage"] ?? (yield* promptText("New rollout percentage (1-100)"));
        const percentage = yield* parseRolloutPercentage(rolloutRaw, "rollout-percentage");

        const allUpdates = yield* drainPages((page) =>
          api.updates.list({ urlParams: { projectId, limit: 100, page } }),
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
              path: { id: update.id },
              payload: { percentage },
            }),
          { concurrency: 2 },
        );

        yield* printHuman(
          `Set rollout to ${String(percentage)}% for ${String(inGroup.length)} update(s) in group ${groupId}.`,
        );
        return undefined;
      }),
      updateErrorExtras,
    ),
});

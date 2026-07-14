import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { parseLimit } from "../../lib/cli-schemas";
import { drainPages } from "../../lib/drain-cursor";
import { printHuman, printHumanKeyValue, printList } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { resolveNamedResourceId, UpdateCommandError, updateErrorExtras } from "./helpers";

import type { ApiClient } from "../../services/api-client";

// Management commands for embedded baselines (EAS `update:embedded:*` parity):
// registrations of the JS bundle baked into a native build, used as bsdiff
// patch bases. They are `isEmbedded` update rows — never served as OTA updates
// — so every command here goes through the isEmbedded read filter/guard.

const requireEmbedded = (api: ApiClient, id: string) =>
  Effect.gen(function* () {
    const update = yield* api.updates.get({ path: { id } });
    if (!update.isEmbedded) {
      return yield* new UpdateCommandError({
        message: `Update "${id}" is not an embedded baseline. Use \`update view\`/\`update delete\` for published updates.`,
      });
    }
    return update;
  });

export const embeddedListCommand = defineCommand({
  meta: { name: "embedded:list", description: "List registered embedded baselines" },
  args: {
    branch: { type: "string", description: "Filter by branch name" },
    platform: {
      type: "enum",
      options: ["ios", "android"],
      description: "Filter by platform",
    },
    "runtime-version": { type: "string", description: "Filter by runtime version" },
    limit: { type: "string", default: "20", description: "Max rows (default 20)" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const limit = yield* parseLimit(args.limit, 20);
        const projectId = yield* readProjectId;
        const api = yield* apiClient;
        const branches = yield* drainPages((page) =>
          api.branches.list({ urlParams: { projectId, limit: 100, page } }),
        );
        const branchId = args.branch
          ? yield* resolveNamedResourceId({ items: branches, kind: "Branch", name: args.branch })
          : undefined;

        const { items } = yield* api.updates.list({
          urlParams: {
            projectId,
            isEmbedded: true,
            limit,
            ...compact({
              branchId: branchId ? [branchId] : undefined,
              platform: args.platform,
              runtimeVersion: args["runtime-version"],
            }),
          },
        });

        const branchNames = new Map(branches.map((item) => [item.id, item.name]));
        yield* printList(
          ["Embedded ID", "Branch", "Platform", "Runtime", "Bundle size", "Created"],
          items.map((item) => [
            item.id,
            branchNames.get(item.branchId) ?? item.branchId,
            item.platform,
            item.runtimeVersion,
            `${String(item.totalAssetSize)} B`,
            item.createdAt,
          ]),
          "No embedded baselines registered. Run `update embedded:upload` after a native build.",
        );
      }),
      updateErrorExtras,
    ),
});

export const embeddedViewCommand = defineCommand({
  meta: { name: "embedded:view", description: "Show details for an embedded baseline" },
  args: {
    id: {
      type: "positional",
      required: true,
      description: "Embedded baseline ID (the binary's app.manifest UUID)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const update = yield* requireEmbedded(api, args.id);
        yield* printHumanKeyValue([
          ["Embedded ID", update.id],
          ["Group ID", update.groupId],
          ["Branch ID", update.branchId],
          ["Platform", update.platform],
          ["Runtime version", update.runtimeVersion],
          ["Bundle size", `${String(update.totalAssetSize)} B`],
          ["Created", update.createdAt],
          ["Message", update.message],
        ]);
        return update;
      }),
      { exits: updateErrorExtras, json: "value" },
    ),
});

export const embeddedDeleteCommand = defineCommand({
  meta: { name: "embedded:delete", description: "Delete a registered embedded baseline" },
  args: {
    id: {
      type: "positional",
      required: true,
      description: "Embedded baseline ID (the binary's app.manifest UUID)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const update = yield* requireEmbedded(api, args.id);
        const result = yield* api.updates.deleteGroup({ path: { groupId: update.groupId } });
        yield* printHuman(`Deleted embedded baseline ${args.id}.`);
        yield* printHuman(
          "Note: bsdiff patches already generated against this bundle keep serving; new first-launch patches need a re-registered baseline.",
        );
        return { id: args.id, groupId: update.groupId, ...result };
      }),
      { exits: updateErrorExtras, json: "value" },
    ),
});

import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { readProjectId } from "../../lib/app-json";
import { runEffect } from "../../lib/citty-effect";
import { parseLimit } from "../../lib/cli-schemas";
import { drainPages } from "../../lib/drain-cursor";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { resolveNamedResourceId, updateErrorExtras } from "./helpers";

export const listCommand = defineCommand({
  meta: { name: "list", description: "List recent updates" },
  args: {
    branch: { type: "string", description: "Filter by branch name" },
    limit: { type: "string", default: "20", description: "Max rows (default 20)" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const limit = yield* parseLimit(args.limit, 20);
        const projectId = yield* readProjectId;
        const api = yield* apiClient;
        const branches = yield* drainPages((page) =>
          api.branches.list({
            urlParams: { projectId, limit: 100, page },
          }),
        );

        const branchId = args.branch
          ? yield* resolveNamedResourceId({
              items: branches,
              kind: "Branch",
              name: args.branch,
            })
          : undefined;

        const { items } = yield* api.updates.list({
          urlParams: {
            projectId,
            ...(branchId === undefined ? {} : { branchId }),
            limit,
          },
        });

        if (items.length === 0) {
          yield* Console.log("No updates found.");
          return;
        }

        const branchNames = new Map(branches.map((item) => [item.id, item.name]));

        yield* printTable(
          ["Update ID", "Group", "Branch", "Platform", "Runtime", "Rollout", "Rollback", "Created"],
          items.map((item) => [
            item.id,
            item.groupId,
            branchNames.get(item.branchId) ?? item.branchId,
            item.platform,
            item.runtimeVersion,
            `${String(item.rolloutPercentage)}%`,
            item.isRollback ? "yes" : "no",
            item.createdAt,
          ]),
        );
      }),
      updateErrorExtras,
    ),
});

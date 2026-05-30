import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { parseLimit } from "../../lib/cli-schemas";
import { drainPages } from "../../lib/drain-cursor";
import { printList } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { resolveNamedResourceId, updateErrorExtras } from "./helpers";

export const listCommand = defineCommand({
  meta: { name: "list", description: "List recent updates" },
  args: {
    branch: { type: "string", description: "Filter by branch name" },
    platform: {
      type: "enum",
      options: ["ios", "android"],
      description: "Filter by platform",
    },
    limit: { type: "string", default: "20", description: "Max rows (default 20)" },
    offset: { type: "string", description: "Pagination offset (page number, 1-based)" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const limit = yield* parseLimit(args.limit, 20);
        const page = args.offset === undefined ? undefined : yield* parseLimit(args.offset, 1);
        const projectId = yield* readProjectId;
        const api = yield* apiClient;
        const branches = yield* drainPages((cursor) =>
          api.branches.list({
            urlParams: { projectId, limit: 100, page: cursor },
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
            limit,
            ...compact({ branchId, platform: args.platform, page }),
          },
        });

        const branchNames = new Map(branches.map((item) => [item.id, item.name]));

        yield* printList(
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
          "No updates found.",
        );
      }),
      updateErrorExtras,
    ),
});

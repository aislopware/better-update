import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { drainPages } from "../../lib/drain-cursor";
import { printList } from "../../lib/output";
import { optionalFlag, optionalPositiveIntFlag, positiveIntFlag } from "../../lib/params";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { resolveNamedResourceId } from "./helpers";

export const listCommand = Command.make(
  "list",
  {
    branch: Flag.String("branch").pipe(Flag.withDescription("Filter by branch name"), optionalFlag),
    platform: Flag.Literals("platform", ["ios", "android"]).pipe(
      Flag.withDescription("Filter by platform"),
      optionalFlag,
    ),
    limit: positiveIntFlag("limit", { description: "Max rows", defaultValue: 20 }),
    offset: optionalPositiveIntFlag("offset", "Pagination offset (page number, 1-based)"),
  },
  Effect.fn(function* (args) {
    const { limit } = args;
    const page = args.offset;
    const projectId = yield* readProjectId;
    const api = yield* apiClient;
    const branches = yield* drainPages((cursor) =>
      api.branches.list({
        query: { projectId, limit: 100, page: cursor },
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
      query: {
        projectId,
        limit,
        ...compact({
          branchId: branchId ? [branchId] : undefined,
          platform: args.platform,
          page,
        }),
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
  }, runCommand()),
).pipe(Command.withDescription("List recent updates"));

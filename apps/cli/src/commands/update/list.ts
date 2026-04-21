import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";

import { readProjectId } from "../../lib/app-json";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleUpdateCommandErrors, resolveNamedResourceId } from "./helpers";

const branch = Options.text("branch").pipe(Options.optional);
const limit = Options.integer("limit").pipe(Options.withDefault(20));

export const listCommand = Command.make("list", { branch, limit }, (opts) =>
  Effect.gen(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;
    const { items: branches } = yield* api.branches.list({
      urlParams: { projectId, page: 1, limit: 1000 },
    });

    const branchId = yield* Option.match(opts.branch, {
      onNone: () => Effect.succeed(undefined as string | undefined),
      onSome: (branchName) =>
        resolveNamedResourceId({
          items: branches,
          kind: "Branch",
          name: branchName,
        }),
    });

    const { items } = yield* api.updates.list({
      urlParams: {
        projectId,
        ...(branchId === undefined ? {} : { branchId }),
        page: 1,
        limit: opts.limit,
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
  }).pipe(handleUpdateCommandErrors),
);

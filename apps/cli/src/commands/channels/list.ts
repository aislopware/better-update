import { Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { readProjectId } from "../../lib/app-json";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleChannelCommandErrors } from "./helpers";

export const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const [{ items }, { items: branches }] = yield* Effect.all([
      api.channels.list({ urlParams: { projectId, page: 1, limit: 1000 } }),
      api.branches.list({ urlParams: { projectId, page: 1, limit: 1000 } }),
    ]);

    if (items.length === 0) {
      yield* Console.log("No channels found.");
      return;
    }

    const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));

    yield* printTable(
      ["ID", "Name", "Branch", "Paused", "Rollout", "Created"],
      items.map((channel) => [
        channel.id,
        channel.name,
        branchNames.get(channel.branchId) ?? channel.branchId,
        channel.isPaused ? "yes" : "no",
        channel.branchMappingJson === null ? "-" : "active",
        channel.createdAt,
      ]),
    );
  }).pipe(handleChannelCommandErrors),
);

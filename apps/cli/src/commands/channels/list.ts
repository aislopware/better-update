import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { drainPages } from "../../lib/drain-cursor";
import { printList } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

export const listCommand = Command.make(
  "list",
  {},
  Effect.fn(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const [items, branches] = yield* Effect.all([
      drainPages((page) =>
        api.channels.list({
          query: { projectId, limit: 100, page },
        }),
      ),
      drainPages((page) =>
        api.branches.list({
          query: { projectId, limit: 100, page },
        }),
      ),
    ]);

    const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));

    yield* printList(
      ["ID", "Name", "Branch", "Paused", "Rollout", "Created"],
      items.map((channel) => [
        channel.id,
        channel.name,
        branchNames.get(channel.branchId) ?? channel.branchId,
        channel.isPaused ? "yes" : "no",
        channel.branchMappingJson === null ? "-" : "active",
        channel.createdAt,
      ]),
      "No channels found.",
    );
  }, runCommand()),
).pipe(Command.withDescription("List channels for the linked project"));

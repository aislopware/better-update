import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { drainPages } from "../../lib/drain-cursor";
import { printKeyValue } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { resolveNamedResourceId } from "./helpers";

export const createCommand = Command.make(
  "create",
  {
    name: Flag.String("name").pipe(Flag.withDescription("Channel name")),
    branch: Flag.String("branch").pipe(Flag.withDescription("Initial branch name")),
  },
  Effect.fn(function* (args) {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const branches = yield* drainPages((page) =>
      api.branches.list({
        query: { projectId, limit: 100, page },
      }),
    );
    const branchId = yield* resolveNamedResourceId({
      items: branches,
      kind: "Branch",
      name: args.branch,
    });

    const channel = yield* api.channels.create({
      payload: { projectId, name: args.name, branchId },
    });

    yield* printKeyValue([
      ["ID", channel.id],
      ["Name", channel.name],
      ["Branch", args.branch],
      ["Created", channel.createdAt],
    ]);
  }, runCommand()),
).pipe(Command.withDescription("Create a channel"));

import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { drainPages } from "../../lib/drain-cursor";
import { printHuman } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { resolveNamedResourceId } from "./helpers";

export const updateCommand = Command.make(
  "update",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Channel ID")),
    branch: Flag.String("branch").pipe(Flag.withDescription("Target branch name")),
  },
  Effect.fn(
    function* (args) {
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

      const channel = yield* api.channels.update({
        params: { id: args.id },
        payload: { branchId },
      });

      yield* printHuman(`Channel "${channel.name}" relinked to branch "${args.branch}".`);
      return channel;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Relink a channel to a different branch"));

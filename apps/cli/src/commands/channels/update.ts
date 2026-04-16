import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";

import { readProjectId } from "../../lib/app-json";
import { apiClient } from "../../services/api-client";
import { handleChannelCommandErrors, resolveNamedResourceId } from "./helpers";

const id = Args.text({ name: "id" });
const branch = Options.text("branch");

export const updateCommand = Command.make("update", { id, branch }, (opts) =>
  Effect.gen(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const { items: branches } = yield* api.branches.list({
      urlParams: { projectId, page: 1, limit: 1000 },
    });
    const branchId = yield* resolveNamedResourceId({
      items: branches,
      kind: "Branch",
      name: opts.branch,
    });

    const channel = yield* api.channels.update({
      path: { id: opts.id },
      payload: { branchId },
    });

    yield* Console.log(`Channel "${channel.name}" relinked to branch "${opts.branch}".`);
  }).pipe(handleChannelCommandErrors),
);

import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";

import { readProjectId } from "../../../lib/app-json";
import { apiClient } from "../../../services/api-client";
import {
  ChannelCommandError,
  handleChannelCommandErrors,
  resolveNamedResourceId,
} from "../helpers";

const channelId = Args.text({ name: "channelId" });
const branch = Options.text("branch");
const percentage = Options.integer("percentage");

export const createCommand = Command.make("create", { channelId, branch, percentage }, (opts) =>
  Effect.gen(function* () {
    if (opts.percentage < 1 || opts.percentage > 100) {
      yield* new ChannelCommandError({
        message: "Rollout percentage must be between 1 and 100.",
      });
    }

    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const { items: branches } = yield* api.branches.list({
      urlParams: { projectId, page: 1, limit: 1000 },
    });
    const newBranchId = yield* resolveNamedResourceId({
      items: branches,
      kind: "Branch",
      name: opts.branch,
    });

    const channel = yield* api.channels.createBranchRollout({
      path: { id: opts.channelId },
      payload: { newBranchId, percentage: opts.percentage },
    });

    yield* Console.log(
      `Started rollout on channel "${channel.name}" to branch "${opts.branch}" at ${String(opts.percentage)}%.`,
    );
  }).pipe(handleChannelCommandErrors),
);

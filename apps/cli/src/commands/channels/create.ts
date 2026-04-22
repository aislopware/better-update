import { defineCommand } from "citty";
import { Effect } from "effect";

import { readProjectId } from "../../lib/app-json";
import { runEffect } from "../../lib/citty-effect";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { channelErrorExtras, resolveNamedResourceId } from "./helpers";

export const createCommand = defineCommand({
  meta: { name: "create", description: "Create a channel" },
  args: {
    name: { type: "string", required: true, description: "Channel name" },
    branch: { type: "string", required: true, description: "Initial branch name" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const { items: branches } = yield* api.branches.list({
          urlParams: { projectId, page: 1, limit: 1000 },
        });
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
      }),
      channelErrorExtras,
    ),
});

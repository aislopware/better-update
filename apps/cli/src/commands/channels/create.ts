import { Command, Options } from "@effect/cli";
import { Effect } from "effect";

import { readProjectId } from "../../lib/app-json";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleChannelCommandErrors, resolveNamedResourceId } from "./helpers";

const name = Options.text("name");
const branch = Options.text("branch");

export const createCommand = Command.make("create", { name, branch }, (opts) =>
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

    const channel = yield* api.channels.create({
      payload: { projectId, name: opts.name, branchId },
    });

    yield* printKeyValue([
      ["ID", channel.id],
      ["Name", channel.name],
      ["Branch", opts.branch],
      ["Created", channel.createdAt],
    ]);
  }).pipe(handleChannelCommandErrors),
);

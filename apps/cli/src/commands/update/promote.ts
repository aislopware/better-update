import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";

import { readProjectId } from "../../lib/app-json";
import { apiClient } from "../../services/api-client";
import { handleUpdateCommandErrors, resolveNamedResourceId } from "./helpers";

const updateId = Args.text({ name: "updateId" });
const channel = Options.text("channel");

export const promoteCommand = Command.make("promote", { updateId, channel }, (opts) =>
  Effect.gen(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;
    const { items: channels } = yield* api.channels.list({
      urlParams: { projectId, page: 1, limit: 1000 },
    });

    const targetChannelId = yield* resolveNamedResourceId({
      items: channels,
      kind: "Channel",
      name: opts.channel,
    });

    const result = yield* api.updates.republish({
      payload: { sourceUpdateId: opts.updateId, targetChannelId },
    });

    yield* Console.log(
      `Promoted update ${opts.updateId} to channel "${opts.channel}" as update ${result.id}.`,
    );
  }).pipe(handleUpdateCommandErrors),
);

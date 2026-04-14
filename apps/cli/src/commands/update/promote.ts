import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";

import { apiClient } from "../../services/api-client";
import { handleUpdateCommandErrors } from "./helpers";

const updateId = Args.text({ name: "updateId" });
const channel = Options.text("channel");

export const promoteCommand = Command.make("promote", { updateId, channel }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const result = yield* api.updates.republish({
      payload: {
        sourceUpdateId: opts.updateId,
        destinationChannel: opts.channel,
      },
    });
    const promotedUpdate = result.updates[0];
    if (!promotedUpdate) {
      return;
    }

    yield* Console.log(
      `Promoted update ${opts.updateId} to channel "${opts.channel}" as update ${promotedUpdate.id}.`,
    );
  }).pipe(handleUpdateCommandErrors),
);

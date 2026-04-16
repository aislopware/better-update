import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { apiClient } from "../../services/api-client";
import { handleChannelCommandErrors } from "./helpers";

const id = Args.text({ name: "id" });

export const pauseCommand = Command.make("pause", { id }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const channel = yield* api.channels.pause({ path: { id: opts.id } });
    yield* Console.log(`Channel "${channel.name}" paused.`);
  }).pipe(handleChannelCommandErrors),
);

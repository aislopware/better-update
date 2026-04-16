import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { apiClient } from "../../services/api-client";
import { handleChannelCommandErrors } from "./helpers";

const id = Args.text({ name: "id" });

export const resumeCommand = Command.make("resume", { id }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const channel = yield* api.channels.resume({ path: { id: opts.id } });
    yield* Console.log(`Channel "${channel.name}" resumed.`);
  }).pipe(handleChannelCommandErrors),
);

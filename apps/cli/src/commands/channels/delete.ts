import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { apiClient } from "../../services/api-client";
import { handleChannelCommandErrors } from "./helpers";

const id = Args.text({ name: "id" });

export const deleteCommand = Command.make("delete", { id }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    yield* api.channels.delete({ path: { id: opts.id } });
    yield* Console.log(`Channel ${opts.id} deleted.`);
  }).pipe(handleChannelCommandErrors),
);

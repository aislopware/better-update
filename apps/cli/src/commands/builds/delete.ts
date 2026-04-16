import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { apiClient } from "../../services/api-client";
import { handleBuildsCommandErrors } from "./helpers";

const id = Args.text({ name: "id" });

export const deleteCommand = Command.make("delete", { id }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    yield* api.builds.delete({ path: { id: opts.id } });
    yield* Console.log(`Build ${opts.id} deleted.`);
  }).pipe(handleBuildsCommandErrors),
);

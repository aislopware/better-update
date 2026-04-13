import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { apiClient } from "../../services/api-client";

const id = Args.text({ name: "id" });

export const deleteCommand = Command.make("delete", { id }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const result = yield* api.credentials.delete({ path: { id: opts.id } });
    yield* Console.log(`Credential ${result.id} deleted.`);
  }),
);

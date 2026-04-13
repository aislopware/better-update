import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { apiClient } from "../../services/api-client";

const id = Args.text({ name: "id" });

export const activateCommand = Command.make("activate", { id }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    yield* api.credentials.activate({ path: { id: opts.id } });
    yield* Console.log(`Credential ${opts.id} activated.`);
  }),
);

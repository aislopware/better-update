import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";

import { readProjectId } from "../../lib/app-json";
import { apiClient } from "../../services/api-client";

const key = Args.text({ name: "KEY" });
const environment = Options.text("environment").pipe(Options.withDefault("production"));

export const deleteCommand = Command.make("delete", { key, environment }, ({ key, environment }) =>
  Effect.gen(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const existing = yield* api["env-vars"].list({
      urlParams: { projectId, environment },
    });

    const match = existing.items.find((item) => item.key === key);

    if (!match) {
      return yield* Effect.fail(
        new Error(`Environment variable ${key} not found in ${environment}`),
      );
    }

    yield* api["env-vars"].delete({ path: { id: match.id } });
    yield* Console.log(`Deleted ${key} from ${environment}`);
  }),
);

import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";

import { readProjectId } from "../../lib/app-json";
import { apiClient } from "../../services/api-client";
import { EnvResourceNotFoundError, handleEnvCommandErrors } from "./helpers";

const keyArg = Args.text({ name: "KEY" });
const environmentOption = Options.text("environment").pipe(Options.withDefault("production"));

export const deleteCommand = Command.make(
  "delete",
  { key: keyArg, environment: environmentOption },
  ({ key, environment }) =>
    Effect.gen(function* () {
      const projectId = yield* readProjectId;
      const api = yield* apiClient;

      const existing = yield* api["env-vars"].list({
        urlParams: { projectId, environment },
      });

      const match = existing.items.find((item) => item.key === key);

      if (!match) {
        return yield* new EnvResourceNotFoundError({
          message: `Environment variable ${key} not found in ${environment}`,
        });
      }

      yield* api["env-vars"].delete({ path: { id: match.id } });
      yield* Console.log(`Deleted ${key} from ${environment}`);
      return undefined;
    }).pipe(handleEnvCommandErrors),
);

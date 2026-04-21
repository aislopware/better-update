import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";

import { readProjectId } from "../../lib/app-json";
import { keyValueArg } from "../../lib/cli-schemas";
import { apiClient } from "../../services/api-client";
import { handleEnvCommandErrors } from "./helpers";

const keyValue = keyValueArg("KEY=VALUE");
const environmentOption = Options.text("environment").pipe(Options.withDefault("production"));
const visibilityOption = Options.choice("visibility", ["plaintext", "sensitive", "secret"]).pipe(
  Options.withDefault("plaintext" as const),
);

export const setCommand = Command.make(
  "set",
  { keyValue, environment: environmentOption, visibility: visibilityOption },
  ({ keyValue: { key, value }, environment, visibility }) =>
    Effect.gen(function* () {
      const projectId = yield* readProjectId;
      const api = yield* apiClient;

      const existing = yield* api["env-vars"].list({
        urlParams: { projectId, environment },
      });

      const match = existing.items.find((item) => item.key === key);

      if (match) {
        yield* api["env-vars"].update({
          path: { id: match.id },
          payload: { value, visibility },
        });
        yield* Console.log(`Updated ${key} in ${environment}`);
      } else {
        yield* api["env-vars"].create({
          payload: { projectId, environment, key, value, visibility },
        });
        yield* Console.log(`Created ${key} in ${environment}`);
      }
    }).pipe(handleEnvCommandErrors),
);

import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";

import { readProjectId } from "../../lib/app-json";
import { apiClient } from "../../services/api-client";

const keyValue = Args.text({ name: "KEY=VALUE" });
const environment = Options.text("environment").pipe(Options.withDefault("production"));
const visibility = Options.choice("visibility", ["plaintext", "sensitive", "secret"]).pipe(
  Options.withDefault("plaintext" as const),
);

export const setCommand = Command.make(
  "set",
  { keyValue, environment, visibility },
  ({ keyValue, environment, visibility }) =>
    Effect.gen(function* () {
      const eqIndex = keyValue.indexOf("=");
      if (eqIndex === -1) {
        return yield* Effect.fail(new Error("Invalid format. Use KEY=VALUE (e.g. API_KEY=abc123)"));
      }

      const key = keyValue.slice(0, eqIndex);
      const value = keyValue.slice(eqIndex + 1);

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
    }),
);

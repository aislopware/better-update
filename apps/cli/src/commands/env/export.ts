import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";

import { readProjectId } from "../../lib/app-json";
import { apiClient } from "../../services/api-client";
import { handleEnvCommandErrors } from "./helpers";

const environmentOption = Options.text("environment").pipe(Options.withDefault("production"));

export const exportCommand = Command.make(
  "export",
  { environment: environmentOption },
  ({ environment }) =>
    Effect.gen(function* () {
      const projectId = yield* readProjectId;
      const api = yield* apiClient;

      const result = yield* api["env-vars"].export({
        urlParams: { projectId, environment },
      });

      for (const item of result.items) {
        const escaped = item.value.replaceAll("'", String.raw`'\''`);
        yield* Console.log(`${item.key}='${escaped}'`);
      }
    }).pipe(handleEnvCommandErrors),
);

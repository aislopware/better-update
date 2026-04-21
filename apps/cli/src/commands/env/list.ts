import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";

import { readProjectId } from "../../lib/app-json";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleEnvCommandErrors } from "./helpers";

const environmentOption = Options.text("environment").pipe(Options.optional);

export const listCommand = Command.make(
  "list",
  { environment: environmentOption },
  ({ environment }) =>
    Effect.gen(function* () {
      const projectId = yield* readProjectId;
      const api = yield* apiClient;

      const envFilter = Option.match(environment, {
        onNone: () => ({}),
        onSome: (value) => ({ environment: value }),
      });

      const result = yield* api["env-vars"].list({
        urlParams: { projectId, ...envFilter },
      });

      if (result.items.length === 0) {
        yield* Console.log("No environment variables found.");
        return;
      }

      yield* printTable(
        ["Key", "Environment", "Visibility", "Value"],
        result.items.map((item) => [
          item.key,
          item.environment,
          item.visibility,
          // eslint-disable-next-line eslint-js/no-restricted-syntax -- EnvVar.value nullable at storage; display empty when absent
          item.visibility === "plaintext" ? (item.value ?? "") : "••••••",
        ]),
      );
    }).pipe(handleEnvCommandErrors),
);

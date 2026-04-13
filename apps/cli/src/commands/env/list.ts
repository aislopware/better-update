import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";

import { readProjectId } from "../../lib/app-json";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";

const environment = Options.text("environment").pipe(Options.optional);

export const listCommand = Command.make("list", { environment }, ({ environment }) =>
  Effect.gen(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const envFilter = Option.match(environment, {
      onNone: () => ({}),
      onSome: (v) => ({ environment: v }),
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
        item.visibility === "plaintext" ? (item.value ?? "") : "••••••",
      ]),
    );
  }),
);

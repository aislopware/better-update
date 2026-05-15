import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { readProjectId } from "../../lib/expo-config";
import { apiClient } from "../../services/api-client";
import { envErrorExtras, parseSingleEnvironmentArg } from "./helpers";

export const pullCommand = defineCommand({
  meta: { name: "pull", description: "Print env vars in `export KEY='value'` format" },
  args: {
    environment: {
      type: "string",
      default: "production",
      description: "Target environment (development, preview, production)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const environment = yield* parseSingleEnvironmentArg(args.environment);
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const result = yield* api["env-vars"].export({
          urlParams: { projectId, environment },
        });

        for (const item of result.items) {
          const escaped = item.value.replaceAll("'", String.raw`'\''`);
          yield* Console.log(`export ${item.key}='${escaped}'`);
        }
      }),
      envErrorExtras,
    ),
});

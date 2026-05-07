import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { readProjectId } from "../../lib/expo-config";
import { apiClient } from "../../services/api-client";
import { envErrorExtras } from "./helpers";

export const exportCommand = defineCommand({
  meta: { name: "export", description: "Print env vars in KEY='value' format" },
  args: {
    environment: { type: "string", default: "production", description: "Target environment" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const result = yield* api["env-vars"].export({
          urlParams: { projectId, environment: args.environment },
        });

        for (const item of result.items) {
          const escaped = item.value.replaceAll("'", String.raw`'\''`);
          yield* Console.log(`${item.key}='${escaped}'`);
        }
      }),
      envErrorExtras,
    ),
});

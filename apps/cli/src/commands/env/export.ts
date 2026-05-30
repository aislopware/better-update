import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { exportDecryptedEnvVars } from "../../lib/env-exporter";
import { printHuman } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { envErrorExtras, parseSingleEnvironmentArg } from "./helpers";

export const exportCommand = defineCommand({
  meta: { name: "export", description: "Print env vars in KEY='value' format" },
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

        const items = yield* exportDecryptedEnvVars(api, projectId, environment);

        for (const item of items) {
          const escaped = item.value.replaceAll("'", String.raw`'\''`);
          yield* printHuman(`${item.key}='${escaped}'`);
        }
        return { environment, items };
      }),
      { exits: envErrorExtras, json: "value" },
    ),
});

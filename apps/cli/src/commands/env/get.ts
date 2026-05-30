import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { exportDecryptedEnvVars } from "../../lib/env-exporter";
import { printKeyValue } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { EnvResourceNotFoundError, envErrorExtras, parseSingleEnvironmentArg } from "./helpers";

export const getCommand = defineCommand({
  meta: {
    name: "get",
    description:
      "Show an environment variable's effective value for an environment (decrypted locally)",
  },
  args: {
    key: {
      type: "positional",
      required: true,
      description: "Env var KEY (uppercase)",
    },
    environment: {
      type: "string",
      default: "production",
      description: "Target environment (development, preview, production)",
    },
    "include-sensitive": {
      type: "boolean",
      description: "Reveal masked sensitive values",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const environment = yield* parseSingleEnvironmentArg(args.environment);
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        // Resolves the effective (project-over-global) value, decrypted locally.
        const items = yield* exportDecryptedEnvVars(api, projectId, environment);
        const match = items.find((item) => item.key === args.key);
        if (!match) {
          return yield* new EnvResourceNotFoundError({
            message: `No env var "${args.key}" found for environment "${environment}".`,
          });
        }

        const includeSensitive = args["include-sensitive"] ?? false;
        const value =
          match.visibility === "sensitive" && !includeSensitive ? "******" : match.value;

        yield* printKeyValue([
          ["Key", match.key],
          ["Environment", environment],
          ["Visibility", match.visibility],
          ["Value", value],
        ]);
        return undefined;
      }),
      envErrorExtras,
    ),
});

import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { readProjectId } from "../../lib/expo-config";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { envErrorExtras } from "./helpers";

export const listCommand = defineCommand({
  meta: { name: "list", description: "List environment variables" },
  args: {
    environment: { type: "string", description: "Filter by environment" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const envFilter = args.environment ? { environment: args.environment } : {};

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
      }),
      envErrorExtras,
    ),
});

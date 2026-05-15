import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { readProjectId } from "../../lib/expo-config";
import { printList } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { envErrorExtras, formatEnvironments } from "./helpers";

export const listCommand = defineCommand({
  meta: { name: "list", description: "List environment variables" },
  args: {
    environments: {
      type: "string",
      description:
        "Filter by environments (comma-separated, e.g. development,production). Default: all",
    },
    scope: {
      type: "enum",
      options: ["all", "project", "global"],
      description: "Filter by scope (default: all — merged with global override resolution)",
    },
    search: { type: "string", description: "Filter by key substring (case-insensitive)" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const urlParams = {
          projectId,
          ...(args.scope ? { scope: args.scope } : {}),
          ...(args.environments ? { environments: args.environments } : {}),
          ...(args.search ? { search: args.search } : {}),
        };

        const result = yield* api["env-vars"].list({ urlParams });

        yield* printList(
          ["Key", "Environments", "Scope", "Visibility", "Value"],
          result.items.map((item) => [
            item.key,
            formatEnvironments(item.environments),
            item.overridesGlobal ? `${item.scope} (overrides global)` : item.scope,
            item.visibility,
            // eslint-disable-next-line eslint-js/no-restricted-syntax -- EnvVar.value nullable at storage; display empty when absent
            item.visibility === "plaintext" ? (item.value ?? "") : "••••••",
          ]),
          "No environment variables found.",
        );
      }),
      envErrorExtras,
    ),
});

import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printList } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { envErrorExtras } from "./helpers";

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description:
      "List environment variable metadata. Values are end-to-end encrypted — read them with `env pull`, `env export`, or `env get`.",
  },
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
          ["Key", "Environment", "Scope", "Visibility", "Revisions"],
          result.items.map((item) => [
            item.key,
            item.environment,
            item.overridesGlobal ? `${item.scope} (overrides global)` : item.scope,
            item.visibility,
            String(item.revisionCount),
          ]),
          "No environment variables found.",
        );
      }),
      envErrorExtras,
    ),
});

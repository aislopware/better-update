import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { parseLimit } from "../../lib/cli-schemas";
import { readProjectId } from "../../lib/expo-config";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";

export const listCommand = defineCommand({
  meta: { name: "list", description: "List builds for the linked project" },
  args: {
    platform: { type: "enum", options: ["ios", "android"], description: "Filter by platform" },
    limit: { type: "string", default: "10", description: "Max rows (default 10)" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const limit = yield* parseLimit(args.limit, 10);
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const platformFilter = args.platform ? { platform: args.platform } : {};

        const { items } = yield* api.builds.list({
          urlParams: { projectId, ...platformFilter, limit },
        });

        yield* printTable(
          ["ID", "Platform", "Profile", "Distribution", "Version", "Created"],
          items.map((build) => [
            build.id,
            build.platform,
            build.profile,
            build.distribution,
            build.appVersion ?? "-",
            build.createdAt,
          ]),
        );
      }),
    ),
});

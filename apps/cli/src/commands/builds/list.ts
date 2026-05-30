import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { parseLimit } from "../../lib/cli-schemas";
import { printTable } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";

const SORT_OPTIONS = [
  "createdAt",
  "-createdAt",
  "platform",
  "-platform",
  "distribution",
  "-distribution",
  "runtimeVersion",
  "-runtimeVersion",
  "appVersion",
  "-appVersion",
] as const;

const DISTRIBUTION_OPTIONS = [
  "app-store",
  "ad-hoc",
  "development",
  "enterprise",
  "simulator",
  "play-store",
  "direct",
] as const;

export const listCommand = defineCommand({
  meta: { name: "list", description: "List builds for the linked project" },
  args: {
    platform: { type: "enum", options: ["ios", "android"], description: "Filter by platform" },
    profile: { type: "string", description: "Filter by build profile name" },
    "runtime-version": { type: "string", description: "Filter by runtime version" },
    distribution: {
      type: "enum",
      options: [...DISTRIBUTION_OPTIONS],
      description: "Filter by distribution channel",
    },
    sort: {
      type: "enum",
      options: [...SORT_OPTIONS],
      description: "Sort column; prefix with `-` for descending (e.g. -createdAt)",
    },
    limit: { type: "string", default: "10", description: "Max rows (default 10)" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const limit = yield* parseLimit(args.limit, 10);
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const { items } = yield* api.builds.list({
          urlParams: {
            projectId,
            limit,
            ...compact({
              platform: args.platform,
              profile: args.profile,
              runtimeVersion: args["runtime-version"],
              distribution: args.distribution,
              sort: args.sort,
            }),
          },
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

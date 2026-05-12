import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { parseLimit } from "../../lib/cli-schemas";
import { readProjectId } from "../../lib/expo-config";
import { printTable } from "../../lib/output";
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
            ...(args.platform === undefined ? {} : { platform: args.platform }),
            ...(args.profile === undefined ? {} : { profile: args.profile }),
            ...(args["runtime-version"] === undefined
              ? {}
              : { runtimeVersion: args["runtime-version"] }),
            ...(args.distribution === undefined ? {} : { distribution: args.distribution }),
            ...(args.sort === undefined ? {} : { sort: args.sort }),
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

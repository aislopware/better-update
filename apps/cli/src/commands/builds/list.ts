import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { printTable } from "../../lib/output";
import { optionalFlag, positiveIntFlag } from "../../lib/params";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
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

export const listCommand = Command.make(
  "list",
  {
    platform: Flag.Literals("platform", ["ios", "android"]).pipe(
      Flag.withDescription("Filter by platform"),
      optionalFlag,
    ),
    profile: Flag.String("profile").pipe(
      Flag.withDescription("Filter by build profile name"),
      optionalFlag,
    ),
    "runtime-version": Flag.String("runtime-version").pipe(
      Flag.withDescription("Filter by runtime version"),
      optionalFlag,
    ),
    distribution: Flag.Literals("distribution", [...DISTRIBUTION_OPTIONS]).pipe(
      Flag.withDescription("Filter by distribution channel"),
      optionalFlag,
    ),
    sort: Flag.Literals("sort", [...SORT_OPTIONS]).pipe(
      Flag.withDescription("Sort column; prefix with `-` for descending (e.g. -createdAt)"),
      optionalFlag,
    ),
    limit: positiveIntFlag("limit", { description: "Max rows", defaultValue: 10 }),
  },
  Effect.fn(function* (args) {
    const { limit } = args;
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const { items } = yield* api.builds.list({
      query: {
        projectId,
        limit,
        ...compact({
          platform: args.platform,
          profile: args.profile,
          runtimeVersion: args["runtime-version"],
          distribution: args.distribution ? [args.distribution] : undefined,
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
  }, runCommand()),
).pipe(Command.withDescription("List builds for the linked project"));

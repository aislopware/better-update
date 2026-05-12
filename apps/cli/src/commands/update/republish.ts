import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { drainPages } from "../../lib/drain-cursor";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { readProjectId } from "../../lib/expo-config";
import { printHuman, printJson, printTable } from "../../lib/output";
import { OutputMode } from "../../lib/output-mode";
import { apiClient } from "../../services/api-client";

import type { ApiClient } from "../../services/api-client";

interface SourceArgs {
  readonly group?: string | undefined;
  readonly update?: string | undefined;
  readonly branch?: string | undefined;
  readonly platform?: string | undefined;
}

interface ResolvedSource {
  readonly sourceGroupId?: string | undefined;
  readonly sourceUpdateId?: string | undefined;
}

const ensureSingleSource = (args: SourceArgs) => {
  const provided = [args.group, args.update, args.branch].filter(
    (value) => value !== undefined && value.length > 0,
  );
  if (provided.length === 0) {
    return Effect.fail(
      new InvalidArgumentError({
        message:
          "Pass one of --group <groupId>, --update <updateId>, or --branch <branchName> to pick a source.",
      }),
    );
  }
  if (provided.length > 1) {
    return Effect.fail(
      new InvalidArgumentError({
        message: "Pass only one of --group, --update, or --branch.",
      }),
    );
  }
  return Effect.void;
};

const resolveSource = (api: ApiClient, args: SourceArgs) => {
  if (args.group !== undefined && args.group.length > 0) {
    return Effect.succeed<ResolvedSource>({ sourceGroupId: args.group });
  }
  if (args.update !== undefined && args.update.length > 0) {
    return Effect.succeed<ResolvedSource>({ sourceUpdateId: args.update });
  }
  return resolveLatestGroupOnBranch(api, args);
};

const resolveLatestGroupOnBranch = (api: ApiClient, args: SourceArgs) =>
  Effect.gen(function* () {
    if (args.branch === undefined || args.branch.length === 0) {
      return yield* new InvalidArgumentError({ message: "Missing --branch <branchName>" });
    }
    const branchName = args.branch;
    const projectId = yield* readProjectId;
    const branches = yield* drainPages((page) =>
      api.branches.list({ urlParams: { projectId, limit: 100, page } }),
    );
    const branch = branches.find((entry) => entry.name === branchName);
    if (!branch) {
      return yield* new InvalidArgumentError({
        message: `Branch "${branchName}" not found in project.`,
      });
    }
    const { items } = yield* api.updates.list({
      urlParams: { projectId, branchId: branch.id, limit: 20 },
    });
    const candidates =
      args.platform === undefined ? items : items.filter((item) => item.platform === args.platform);
    if (candidates.length === 0) {
      return yield* new InvalidArgumentError({
        message: `No updates found on branch "${branchName}"${
          args.platform === undefined ? "" : ` for platform ${args.platform}`
        }.`,
      });
    }
    const [latest] = candidates;
    if (!latest) {
      return yield* new InvalidArgumentError({
        message: `No updates found on branch "${branchName}".`,
      });
    }
    return { sourceGroupId: latest.groupId };
  });

interface DestinationArgs {
  readonly "to-branch"?: string | undefined;
  readonly "to-channel"?: string | undefined;
}

interface ResolvedDestination {
  readonly destinationBranchId?: string | undefined;
  readonly destinationChannel?: string | undefined;
}

const ensureSingleDestination = (args: DestinationArgs) => {
  const provided = [args["to-branch"], args["to-channel"]].filter(
    (value) => value !== undefined && value.length > 0,
  );
  if (provided.length === 0) {
    return Effect.fail(
      new InvalidArgumentError({
        message: "Pass --to-branch <id> or --to-channel <name> to choose a destination.",
      }),
    );
  }
  if (provided.length > 1) {
    return Effect.fail(
      new InvalidArgumentError({
        message: "Pass only one of --to-branch or --to-channel.",
      }),
    );
  }
  return Effect.void;
};

const resolveDestination = (args: DestinationArgs): ResolvedDestination => {
  if (args["to-branch"] !== undefined && args["to-branch"].length > 0) {
    return { destinationBranchId: args["to-branch"] };
  }
  return { destinationChannel: args["to-channel"] };
};

export const republishCommand = defineCommand({
  meta: {
    name: "republish",
    description:
      "Copy an existing update (group, single update, or latest on a branch) to another branch or channel, preserving the runtime version",
  },
  args: {
    group: { type: "string", description: "Source group ID (republish both platforms together)" },
    update: {
      type: "string",
      description: "Source update ID (republish a single platform)",
    },
    branch: {
      type: "string",
      description: "Source branch name — republish the latest update group on this branch",
    },
    platform: {
      type: "enum",
      options: ["ios", "android"],
      description: "When using --branch, restrict to the latest update on this platform",
    },
    "to-branch": {
      type: "string",
      description: "Destination branch ID",
    },
    "to-channel": {
      type: "string",
      description: "Destination channel name (resolves to the channel's mapped branch)",
    },
    message: { type: "string", description: "Override the update message" },
    "project-id": {
      type: "string",
      description: "Project ID (only required when destination is a name and no linked project)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        yield* ensureSingleSource(args);
        yield* ensureSingleDestination(args);

        const api = yield* apiClient;
        const source = yield* resolveSource(api, args);
        const destination = resolveDestination(args);

        const result = yield* api.updates.republish({
          payload: {
            ...source,
            ...destination,
            ...(args["project-id"] === undefined ? {} : { projectId: args["project-id"] }),
            ...(args.message === undefined ? {} : { message: args.message }),
          },
        });
        const mode = yield* OutputMode;
        if (mode.json) {
          yield* printJson(result);
          return undefined;
        }
        yield* printHuman(`Republished ${String(result.updates.length)} update(s).`);
        yield* printTable(
          ["ID", "Platform", "Runtime version", "Group ID"],
          result.updates.map((update) => [
            update.id,
            update.platform,
            update.runtimeVersion,
            update.groupId,
          ]),
        );
        return undefined;
      }),
    ),
});

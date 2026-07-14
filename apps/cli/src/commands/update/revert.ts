import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runUpdateRollback } from "../../application/update-rollback";
import { runEffect } from "../../lib/citty-effect";
import { drainPages } from "../../lib/drain-cursor";
import { printHuman, printHumanTable } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { promptSelect, promptText } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";
import { resolveNamedResourceId, UpdateCommandError, updateErrorExtras } from "./helpers";

import type { ApiClient } from "../../services/api-client";

type RevertChoice = "published" | "embedded";

const promptBranchName = (api: ApiClient, projectId: string) =>
  Effect.gen(function* () {
    const branches = yield* drainPages((page) =>
      api.branches.list({ urlParams: { projectId, limit: 100, page } }),
    );
    if (branches.length === 0) {
      return yield* new UpdateCommandError({
        message: "No branches found in this project.",
      });
    }
    return yield* promptSelect<string>(
      "Which branch to revert?",
      branches.map((branch) => ({ value: branch.name, label: branch.name })),
    );
  });

const findPreviousGroupOnBranch = (
  api: ApiClient,
  projectId: string,
  branchId: string,
  platform: "ios" | "android" | "all",
) =>
  Effect.gen(function* () {
    const updates = yield* drainPages((page) =>
      api.updates.list({ urlParams: { projectId, branchId: [branchId], limit: 100, page } }),
    );
    const filtered =
      platform === "all" ? updates : updates.filter((entry) => entry.platform === platform);
    const seen = new Set<string>();
    const orderedGroups: string[] = [];
    for (const update of filtered) {
      if (!seen.has(update.groupId)) {
        seen.add(update.groupId);
        orderedGroups.push(update.groupId);
      }
    }
    if (orderedGroups.length < 2) {
      return undefined;
    }
    return orderedGroups[1];
  });

const republishGroup = (
  api: ApiClient,
  sourceGroupId: string,
  branchId: string,
  branchName: string,
  message: string | undefined,
) =>
  Effect.gen(function* () {
    yield* printHuman(`Republishing previous group ${sourceGroupId} onto branch "${branchName}".`);
    const result = yield* api.updates.republish({
      payload: {
        sourceGroupId,
        destinationBranchId: branchId,
        ...compact({ message }),
      },
    });
    yield* printHuman(`Republished ${String(result.updates.length)} update(s).`);
    yield* printHumanTable(
      ["ID", "Platform", "Runtime version", "Group ID"],
      result.updates.map((update) => [
        update.id,
        update.platform,
        update.runtimeVersion,
        update.groupId,
      ]),
    );
    return { type: "published" as const, ...result };
  });

const revertToPublished = (
  api: ApiClient,
  projectId: string,
  branchName: string,
  platform: "ios" | "android" | "all",
  message: string | undefined,
) =>
  Effect.gen(function* () {
    const branches = yield* drainPages((page) =>
      api.branches.list({ urlParams: { projectId, limit: 100, page } }),
    );
    const branchId = yield* resolveNamedResourceId({
      items: branches,
      kind: "Branch",
      name: branchName,
    });
    const previousGroup = yield* findPreviousGroupOnBranch(api, projectId, branchId, platform);
    if (previousGroup === undefined) {
      return yield* new UpdateCommandError({
        message: `Branch "${branchName}" does not have a previous update group to revert to. Use --type embedded to publish a rollback-to-embedded directive instead.`,
      });
    }
    return yield* republishGroup(api, previousGroup, branchId, branchName, message);
  });

const revertToEmbedded = (
  branchName: string,
  platform: "ios" | "android" | "all",
  environment: string,
  message: string | undefined,
) =>
  Effect.gen(function* () {
    const result = yield* runUpdateRollback({
      branch: branchName,
      platform,
      environment,
      message,
      commitTime: undefined,
      directiveBodyFile: undefined,
      signatureFile: undefined,
      certificateChainFile: undefined,
      privateKeyPath: undefined,
    });
    yield* printHuman(
      `Created rollback group ${result.groupId} on branch "${result.branch}" at ${result.commitTime}.`,
    );
    yield* printHuman("");
    yield* printHumanTable(
      ["Platform", "Update ID", "Runtime Version"],
      result.results.map((entry) => [entry.platform, entry.updateId, entry.runtimeVersion]),
    );
    return { type: "embedded" as const, ...result };
  });

/**
 * Non-interactive revert addressed by update group id (EAS `update:rollback
 * [GROUP_ID]` parity). The group must be the LATEST group for its
 * (branch, runtime version); the revert then republishes the group before it,
 * or falls back to a rollback-to-embedded directive when the group is the only
 * one on that runtime.
 */
const revertByGroup = (options: {
  readonly api: ApiClient;
  readonly projectId: string;
  readonly groupId: string;
  readonly platform: "ios" | "android" | "all";
  readonly environment: string;
  readonly message: string | undefined;
}) =>
  Effect.gen(function* () {
    const { api, projectId, groupId, platform, environment, message } = options;
    const group = yield* api.updates.getGroup({ path: { groupId } });
    const [sample] = group.items;
    if (!sample) {
      return yield* new UpdateCommandError({
        message: `Update group "${groupId}" not found.`,
      });
    }
    const branches = yield* drainPages((page) =>
      api.branches.list({ urlParams: { projectId, limit: 100, page } }),
    );
    const branch = branches.find((entry) => entry.id === sample.branchId);
    if (!branch) {
      return yield* new UpdateCommandError({
        message: `Update group "${groupId}" belongs to a branch (${sample.branchId}) not in this project.`,
      });
    }
    const updates = yield* drainPages((page) =>
      api.updates.list({
        urlParams: {
          projectId,
          branchId: [branch.id],
          runtimeVersion: sample.runtimeVersion,
          limit: 100,
          page,
          ...compact({ platform: platform === "all" ? undefined : platform }),
        },
      }),
    );
    const orderedGroups: (typeof updates)[number][] = [];
    const seen = new Set<string>();
    for (const update of updates) {
      if (!seen.has(update.groupId)) {
        seen.add(update.groupId);
        orderedGroups.push(update);
      }
    }
    const [latest, previous] = orderedGroups;
    if (latest === undefined || latest.groupId !== groupId) {
      return yield* new UpdateCommandError({
        message: `Update group "${groupId}" is not the latest update on branch "${branch.name}" for runtime version "${sample.runtimeVersion}"${
          latest === undefined ? "" : ` (the latest is "${latest.groupId}")`
        }. Only the latest update can be reverted.`,
      });
    }
    if (previous === undefined) {
      yield* printHuman(
        `No previous update group on branch "${branch.name}" for runtime version "${sample.runtimeVersion}"; publishing a rollback-to-embedded directive instead.`,
      );
      return yield* revertToEmbedded(
        branch.name,
        platform,
        environment,
        message ?? "Roll back to embedded",
      );
    }
    const defaultMessage = `Roll back to "${previous.message}" (group: ${previous.groupId})`;
    return yield* republishGroup(
      api,
      previous.groupId,
      branch.id,
      branch.name,
      message ?? defaultMessage,
    );
  });

const isRevertChoice = (value: string): value is RevertChoice =>
  value === "published" || value === "embedded";

export const revertCommand = defineCommand({
  meta: {
    name: "revert",
    description:
      "Revert the most recent update on a branch — either by republishing the previous group or by publishing a rollback-to-embedded directive",
  },
  args: {
    branch: { type: "string", description: "Branch to revert" },
    group: {
      type: "string",
      description:
        "Update group ID to revert (non-interactive; must be the latest group for its branch + runtime version)",
    },
    platform: {
      type: "enum",
      options: ["ios", "android", "all"],
      default: "all",
      description: "Platform(s) to revert",
    },
    type: {
      type: "enum",
      options: ["published", "embedded"],
      description: "Pick revert target (skips the interactive router)",
    },
    message: { type: "string", description: "Optional update message" },
    environment: {
      type: "string",
      default: "production",
      description: "Env vars scope (only used for embedded rollback)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const projectId = yield* readProjectId;
        if (args.group !== undefined && args.group.length > 0) {
          if ((args.branch !== undefined && args.branch.length > 0) || args.type !== undefined) {
            return yield* new UpdateCommandError({
              message:
                "--group cannot be combined with --branch or --type; the branch and revert target are derived from the group.",
            });
          }
          return yield* revertByGroup({
            api,
            projectId,
            groupId: args.group,
            platform: args.platform,
            environment: args.environment,
            message: args.message,
          });
        }
        const branchName =
          args.branch !== undefined && args.branch.length > 0
            ? args.branch
            : yield* promptBranchName(api, projectId);
        const rawChoice =
          args.type ??
          (yield* promptSelect<string>("Which type of update would you like to revert to?", [
            { value: "published", label: "Published Update (republish the previous group)" },
            {
              value: "embedded",
              label: "Embedded Update (publish rollback-to-embedded directive)",
            },
          ]));
        if (!isRevertChoice(rawChoice)) {
          return yield* new UpdateCommandError({
            message: `Invalid --type "${rawChoice}".`,
          });
        }
        const message =
          args.message ??
          (yield* promptText("Update message (optional, press enter to skip)", {
            defaultValue: "",
          }).pipe(Effect.orElseSucceed(() => "")));
        const messageOrUndefined = message.length === 0 ? undefined : message;
        if (rawChoice === "embedded") {
          return yield* revertToEmbedded(
            branchName,
            args.platform,
            args.environment,
            messageOrUndefined,
          );
        }
        return yield* revertToPublished(
          api,
          projectId,
          branchName,
          args.platform,
          messageOrUndefined,
        );
      }),
      { exits: updateErrorExtras, json: "value" },
    ),
});

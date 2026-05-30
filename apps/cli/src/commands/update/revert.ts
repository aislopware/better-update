import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runUpdateRollback } from "../../application/update-rollback";
import { runEffect } from "../../lib/citty-effect";
import { drainPages } from "../../lib/drain-cursor";
import { readProjectId } from "../../lib/expo-config";
import { printHuman, printHumanTable } from "../../lib/output";
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
      api.updates.list({ urlParams: { projectId, branchId, limit: 100, page } }),
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
    yield* printHuman(`Republishing previous group ${previousGroup} onto branch "${branchName}".`);
    const result = yield* api.updates.republish({
      payload: {
        sourceGroupId: previousGroup,
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

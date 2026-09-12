import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { drainPages } from "../../lib/drain-cursor";
import { printHuman, printHumanKeyValue, printList } from "../../lib/output";
import { optionalFlag, positiveIntFlag } from "../../lib/params";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { resolveNamedResourceId, UpdateCommandError } from "./helpers";

import type { ApiClient } from "../../services/api-client";

// Management commands for embedded baselines (EAS `update:embedded:*` parity):
// registrations of the JS bundle baked into a native build, used as bsdiff
// patch bases. They are `isEmbedded` update rows — never served as OTA updates
// — so every command here goes through the isEmbedded read filter/guard.

const requireEmbedded = (api: ApiClient, id: string) =>
  Effect.gen(function* () {
    const update = yield* api.updates.get({ params: { id } });
    if (!update.isEmbedded) {
      return yield* new UpdateCommandError({
        message: `Update "${id}" is not an embedded baseline. Use \`update view\`/\`update delete\` for published updates.`,
      });
    }
    return update;
  });

export const embeddedListCommand = Command.make(
  "embedded:list",
  {
    branch: Flag.String("branch").pipe(Flag.withDescription("Filter by branch name"), optionalFlag),
    platform: Flag.Literals("platform", ["ios", "android"]).pipe(
      Flag.withDescription("Filter by platform"),
      optionalFlag,
    ),
    "runtime-version": Flag.String("runtime-version").pipe(
      Flag.withDescription("Filter by runtime version"),
      optionalFlag,
    ),
    limit: positiveIntFlag("limit", { description: "Max rows", defaultValue: 20 }),
  },
  Effect.fn(function* (args) {
    const { limit } = args;
    const projectId = yield* readProjectId;
    const api = yield* apiClient;
    const branches = yield* drainPages((page) =>
      api.branches.list({ query: { projectId, limit: 100, page } }),
    );
    const branchId = args.branch
      ? yield* resolveNamedResourceId({ items: branches, kind: "Branch", name: args.branch })
      : undefined;

    const { items } = yield* api.updates.list({
      query: {
        projectId,
        isEmbedded: true,
        limit,
        ...compact({
          branchId: branchId ? [branchId] : undefined,
          platform: args.platform,
          runtimeVersion: args["runtime-version"],
        }),
      },
    });

    const branchNames = new Map(branches.map((item) => [item.id, item.name]));
    yield* printList(
      ["Embedded ID", "Branch", "Platform", "Runtime", "Bundle size", "Created"],
      items.map((item) => [
        item.id,
        branchNames.get(item.branchId) ?? item.branchId,
        item.platform,
        item.runtimeVersion,
        `${String(item.totalAssetSize)} B`,
        item.createdAt,
      ]),
      "No embedded baselines registered. Run `update embedded:upload` after a native build.",
    );
  }, runCommand()),
).pipe(Command.withDescription("List registered embedded baselines"));

export const embeddedViewCommand = Command.make(
  "embedded:view",
  {
    id: Argument.String("id").pipe(
      Argument.withDescription("Embedded baseline ID (the binary's app.manifest UUID)"),
    ),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const update = yield* requireEmbedded(api, args.id);
      yield* printHumanKeyValue([
        ["Embedded ID", update.id],
        ["Group ID", update.groupId],
        ["Branch ID", update.branchId],
        ["Platform", update.platform],
        ["Runtime version", update.runtimeVersion],
        ["Bundle size", `${String(update.totalAssetSize)} B`],
        ["Created", update.createdAt],
        ["Message", update.message],
      ]);
      return update;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Show details for an embedded baseline"));

export const embeddedDeleteCommand = Command.make(
  "embedded:delete",
  {
    id: Argument.String("id").pipe(
      Argument.withDescription("Embedded baseline ID (the binary's app.manifest UUID)"),
    ),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const update = yield* requireEmbedded(api, args.id);
      const result = yield* api.updates.deleteGroup({ params: { groupId: update.groupId } });
      yield* printHuman(`Deleted embedded baseline ${args.id}.`);
      yield* printHuman(
        "Note: bsdiff patches already generated against this bundle keep serving; new first-launch patches need a re-registered baseline.",
      );
      return { id: args.id, groupId: update.groupId, ...result };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Delete a registered embedded baseline"));

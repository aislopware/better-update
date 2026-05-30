import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../lib/citty-effect";
import { drainPages } from "../lib/drain-cursor";
import { InvalidArgumentError } from "../lib/exit-codes";
import { readProjectId } from "../lib/expo-config";
import { printHuman, printHumanKeyValue, printKeyValue, printList } from "../lib/output";
import { apiClient } from "../services/api-client";

const listCommand = defineCommand({
  meta: { name: "list", description: "List branches for the linked project" },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;
        const items = yield* drainPages((page) =>
          api.branches.list({
            urlParams: { projectId, limit: 100, page },
          }),
        );

        yield* printList(
          ["ID", "Name", "Created"],
          items.map((branch) => [branch.id, branch.name, branch.createdAt]),
          "No branches found.",
        );
      }),
    ),
});

const createCommand = defineCommand({
  meta: { name: "create", description: "Create a branch" },
  args: {
    name: { type: "string", required: true, description: "Branch name" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;
        const branch = yield* api.branches.create({
          payload: { projectId, name: args.name },
        });
        yield* printKeyValue([
          ["ID", branch.id],
          ["Name", branch.name],
          ["Created", branch.createdAt],
        ]);
      }),
    ),
});

const viewCommand = defineCommand({
  meta: { name: "view", description: "Show a branch by ID or name" },
  args: {
    target: {
      type: "positional",
      required: true,
      description: "Branch ID or branch name (name requires linked project)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const branch = yield* api.branches.get({ path: { id: args.target } }).pipe(
          Effect.catchTag("NotFound", () =>
            Effect.gen(function* () {
              const projectId = yield* readProjectId;
              const matches = yield* drainPages((page) =>
                api.branches.list({
                  urlParams: { projectId, limit: 100, page },
                }),
              );
              const byName = matches.find((entry) => entry.name === args.target);
              if (!byName) {
                return yield* new InvalidArgumentError({
                  message: `Branch "${args.target}" not found by ID or name.`,
                });
              }
              return byName;
            }),
          ),
        );

        yield* printHumanKeyValue([
          ["ID", branch.id],
          ["Name", branch.name],
          ["Project ID", branch.projectId],
          ["Updates", String(branch.updateCount)],
          ["Created", branch.createdAt],
        ]);
        return branch;
      }),
      { json: "value" },
    ),
});

const renameCommand = defineCommand({
  meta: { name: "rename", description: "Rename a branch" },
  args: {
    id: { type: "positional", required: true, description: "Branch ID" },
    name: { type: "string", required: true, description: "New branch name" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const branch = yield* api.branches.rename({
          path: { id: args.id },
          payload: { name: args.name },
        });
        yield* printHuman(`Branch renamed to "${branch.name}".`);
        return branch;
      }),
      { json: "value" },
    ),
});

const deleteCommand = defineCommand({
  meta: { name: "delete", description: "Delete a branch" },
  args: {
    id: { type: "positional", required: true, description: "Branch ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        yield* api.branches.delete({ path: { id: args.id } });
        yield* printHuman(`Branch ${args.id} deleted.`);
        return { id: args.id, deleted: true };
      }),
      { json: "value" },
    ),
});

export const branchesCommand = defineCommand({
  meta: { name: "branches", description: "Manage branches" },
  subCommands: {
    list: listCommand,
    view: viewCommand,
    create: createCommand,
    rename: renameCommand,
    delete: deleteCommand,
  },
});

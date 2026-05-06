import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { readProjectId } from "../lib/app-json";
import { runEffect } from "../lib/citty-effect";
import { drainPages } from "../lib/drain-cursor";
import { printKeyValue, printTable } from "../lib/output";
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

        if (items.length === 0) {
          yield* Console.log("No branches found.");
          return;
        }

        yield* printTable(
          ["ID", "Name", "Created"],
          items.map((branch) => [branch.id, branch.name, branch.createdAt]),
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
        yield* Console.log(`Branch renamed to "${branch.name}".`);
      }),
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
        yield* Console.log(`Branch ${args.id} deleted.`);
      }),
    ),
});

export const branchesCommand = defineCommand({
  meta: { name: "branches", description: "Manage branches" },
  subCommands: {
    list: listCommand,
    create: createCommand,
    rename: renameCommand,
    delete: deleteCommand,
  },
});

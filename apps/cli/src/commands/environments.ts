import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../lib/citty-effect";
import { printHuman, printKeyValue, printList } from "../lib/output";
import { apiClient } from "../services/api-client";

const listCommand = defineCommand({
  meta: { name: "list", description: "List the organization's environments" },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const { items } = yield* api.environments.list();
        yield* printList(
          ["Name", "Built-in"],
          items.map((environment) => [environment.name, environment.isBuiltin ? "yes" : "no"]),
          "No environments found.",
        );
        return items;
      }),
      { json: "value" },
    ),
});

const createCommand = defineCommand({
  meta: { name: "create", description: "Create a user-defined environment" },
  args: {
    name: {
      type: "positional",
      required: true,
      description: "Environment name (lowercase letters, digits, hyphens)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const environment = yield* api.environments.create({ payload: { name: args.name } });
        yield* printKeyValue([
          ["Name", environment.name],
          ["Created", environment.createdAt],
        ]);
        return environment;
      }),
      { json: "value" },
    ),
});

const renameCommand = defineCommand({
  meta: { name: "rename", description: "Rename a user-defined environment" },
  args: {
    name: { type: "positional", required: true, description: "Current environment name" },
    to: { type: "string", required: true, description: "New environment name" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const environment = yield* api.environments.rename({
          path: { name: args.name },
          payload: { name: args.to },
        });
        yield* printHuman(`Environment renamed to "${environment.name}".`);
        return environment;
      }),
      { json: "value" },
    ),
});

const deleteCommand = defineCommand({
  meta: { name: "delete", description: "Delete a user-defined environment" },
  args: {
    name: { type: "positional", required: true, description: "Environment name" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        yield* api.environments.delete({ path: { name: args.name } });
        yield* printHuman(`Environment "${args.name}" deleted.`);
        return { name: args.name, deleted: true };
      }),
      { json: "value" },
    ),
});

export const environmentsCommand = defineCommand({
  meta: { name: "environments", description: "Manage organization environments" },
  subCommands: {
    list: listCommand,
    create: createCommand,
    rename: renameCommand,
    delete: deleteCommand,
  },
});

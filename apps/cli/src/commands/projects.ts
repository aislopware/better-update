import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../lib/citty-effect";
import { printKeyValue, printTable } from "../lib/output";
import { apiClient } from "../services/api-client";

const listCommand = defineCommand({
  meta: { name: "list", description: "List all projects" },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const { items } = yield* api.projects.list({ urlParams: { page: 1, limit: 1000 } });

        if (items.length === 0) {
          yield* Console.log("No projects found.");
          return;
        }

        yield* printTable(
          ["ID", "Name", "Slug", "Created"],
          items.map((project) => [project.id, project.name, project.slug, project.createdAt]),
        );
      }),
    ),
});

const createCommand = defineCommand({
  meta: { name: "create", description: "Create a new project" },
  args: {
    name: { type: "string", required: true, description: "Display name" },
    slug: { type: "string", required: true, description: "URL-safe slug" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const project = yield* api.projects.create({
          payload: { name: args.name, slug: args.slug },
        });
        yield* printKeyValue([
          ["ID", project.id],
          ["Name", project.name],
          ["Slug", project.slug],
          ["Created", project.createdAt],
        ]);
      }),
    ),
});

const getCommand = defineCommand({
  meta: { name: "get", description: "Show a project" },
  args: {
    id: { type: "positional", required: true, description: "Project ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const project = yield* api.projects.get({ path: { id: args.id } });
        yield* printKeyValue([
          ["ID", project.id],
          ["Name", project.name],
          ["Slug", project.slug],
          ["Created", project.createdAt],
        ]);
      }),
    ),
});

const renameCommand = defineCommand({
  meta: { name: "rename", description: "Rename a project" },
  args: {
    id: { type: "positional", required: true, description: "Project ID" },
    name: { type: "string", required: true, description: "New display name" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const project = yield* api.projects.rename({
          path: { id: args.id },
          payload: { name: args.name },
        });
        yield* Console.log(`Project renamed to "${project.name}".`);
      }),
    ),
});

const deleteCommand = defineCommand({
  meta: { name: "delete", description: "Delete a project" },
  args: {
    id: { type: "positional", required: true, description: "Project ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        yield* api.projects.delete({ path: { id: args.id } });
        yield* Console.log(`Project ${args.id} deleted.`);
      }),
    ),
});

export const projectsCommand = defineCommand({
  meta: { name: "projects", description: "Manage projects" },
  subCommands: {
    list: listCommand,
    create: createCommand,
    get: getCommand,
    rename: renameCommand,
    delete: deleteCommand,
  },
});

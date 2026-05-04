import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../lib/citty-effect";
import { printKeyValue, printTable } from "../lib/output";
import { apiClient } from "../services/api-client";

const listCommand = defineCommand({
  meta: { name: "list", description: "List projects (most recently active first)" },
  args: {
    query: { type: "string", description: "Substring search on name or slug" },
    sort: {
      type: "string",
      description: "Sort key: lastActivityAt (default) or name",
      default: "lastActivityAt",
    },
    limit: { type: "string", description: "Page size (default 50, max 100)", default: "50" },
    page: { type: "string", description: "1-based page number", default: "1" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const sort = args.sort === "name" ? "name" : "lastActivityAt";
        const { items, total, page } = yield* api.projects.list({
          urlParams: {
            page: Number(args.page),
            limit: Number(args.limit),
            sort,
            ...(args.query ? { query: args.query } : {}),
          },
        });

        if (items.length === 0) {
          yield* Console.log("No projects found.");
          return;
        }

        yield* printTable(
          ["ID", "Name", "Slug", "Last activity"],
          items.map((project) => [project.id, project.name, project.slug, project.lastActivityAt]),
        );
        yield* Console.log(`Page ${page} · ${items.length} of ${total} project(s)`);
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

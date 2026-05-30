import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../lib/citty-effect";
import { parseLimit } from "../lib/cli-schemas";
import { printHuman, printHumanKeyValue, printList } from "../lib/output";
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
        const page = yield* parseLimit(args.page, 1);
        const limit = yield* parseLimit(args.limit, 50);
        const result = yield* api.projects.list({
          urlParams: {
            page,
            limit,
            sort,
            ...(args.query ? { query: args.query } : {}),
          },
        });

        yield* printList(
          ["ID", "Name", "Slug", "Last activity"],
          result.items.map((project) => [
            project.id,
            project.name,
            project.slug,
            project.lastActivityAt,
          ]),
          "No projects found.",
        );
        yield* printHuman(
          `Page ${result.page} · ${result.items.length} of ${result.total} project(s)`,
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
        yield* printHumanKeyValue([
          ["ID", project.id],
          ["Name", project.name],
          ["Slug", project.slug],
          ["Created", project.createdAt],
        ]);
        return project;
      }),
      { json: "value" },
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
        yield* printHumanKeyValue([
          ["ID", project.id],
          ["Name", project.name],
          ["Slug", project.slug],
          ["Created", project.createdAt],
        ]);
        return project;
      }),
      { json: "value" },
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
        yield* printHuman(`Project renamed to "${project.name}".`);
        return project;
      }),
      { json: "value" },
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
        yield* printHuman(`Project ${args.id} deleted.`);
        return { id: args.id, deleted: true };
      }),
      { json: "value" },
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

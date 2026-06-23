import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../lib/citty-effect";
import { parseLimit } from "../lib/cli-schemas";
import { printHuman, printHumanKeyValue, printList } from "../lib/output";
import { promptConfirm } from "../lib/prompts";
import { apiClient } from "../services/api-client";

const projectStatus = (archivedAt: string | null): string =>
  archivedAt === null ? "active" : "archived";

// --all wins over --archived; neither flag ⇒ active only (server default).
const listStatus = (
  all: boolean | undefined,
  archived: boolean | undefined,
): "archived" | "all" | undefined => {
  if (all) {
    return "all";
  }
  if (archived) {
    return "archived";
  }
  return undefined;
};

const listCommand = defineCommand({
  meta: { name: "list", description: "List projects (most recently active first)" },
  args: {
    query: { type: "string", description: "Substring search on name or slug" },
    sort: {
      type: "string",
      description: "Sort key: lastActivityAt (default) or name",
      default: "lastActivityAt",
    },
    archived: { type: "boolean", description: "List only archived projects" },
    all: { type: "boolean", description: "List both active and archived projects" },
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
        const status = listStatus(args.all, args.archived);
        const result = yield* api.projects.list({
          urlParams: {
            page,
            limit,
            sort,
            ...(args.query ? { query: args.query } : {}),
            ...(status ? { status } : {}),
          },
        });

        yield* printList(
          ["ID", "Name", "Slug", "Status", "Last activity"],
          result.items.map((project) => [
            project.id,
            project.name,
            project.slug,
            projectStatus(project.archivedAt),
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
          ["Status", projectStatus(project.archivedAt)],
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

const archiveCommand = defineCommand({
  meta: {
    name: "archive",
    description: "Archive a project (hides it and makes it read-only until unarchived)",
  },
  args: {
    id: { type: "positional", required: true, description: "Project ID" },
    yes: { type: "boolean", description: "Skip confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        if (!args.yes) {
          const confirmed = yield* promptConfirm(
            `Archive project ${args.id}? It becomes read-only (no publishes or builds) until unarchived.`,
            { initialValue: false },
          );
          if (!confirmed) {
            yield* printHuman("Cancelled.");
            return undefined;
          }
        }
        const api = yield* apiClient;
        const project = yield* api.projects.archive({ path: { id: args.id } });
        yield* printHuman(
          `Project ${project.name} archived. Unarchive with: projects unarchive ${project.id}`,
        );
        return project;
      }),
      { json: "value" },
    ),
});

const unarchiveCommand = defineCommand({
  meta: { name: "unarchive", description: "Restore an archived project to active, writable state" },
  args: {
    id: { type: "positional", required: true, description: "Project ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const project = yield* api.projects.unarchive({ path: { id: args.id } });
        yield* printHuman(`Project ${project.name} unarchived. It is writable again.`);
        return project;
      }),
      { json: "value" },
    ),
});

const deleteCommand = defineCommand({
  meta: {
    name: "delete",
    description: "Delete a project and all its branches, channels, and updates",
  },
  args: {
    id: { type: "positional", required: true, description: "Project ID" },
    yes: { type: "boolean", description: "Skip confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        if (!args.yes) {
          const confirmed = yield* promptConfirm(
            `Delete project ${args.id}? This permanently removes all its branches, channels, and updates.`,
            { initialValue: false },
          );
          if (!confirmed) {
            yield* printHuman("Cancelled.");
            return undefined;
          }
        }
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
    archive: archiveCommand,
    unarchive: unarchiveCommand,
    delete: deleteCommand,
  },
});

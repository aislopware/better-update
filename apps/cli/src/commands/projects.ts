import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { printHuman, printHumanKeyValue, printList } from "../lib/output";
import { optionalFlag, positiveIntFlag, yesFlag } from "../lib/params";
import { promptConfirm } from "../lib/prompts";
import { runCommand } from "../lib/run-command";
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

const listCommand = Command.make(
  "list",
  {
    query: Flag.String("query").pipe(
      Flag.withDescription("Substring search on name or slug"),
      optionalFlag,
    ),
    sort: Flag.String("sort").pipe(
      Flag.withDescription("Sort key: lastActivityAt (default) or name"),
      Flag.withDefault("lastActivityAt"),
    ),
    archived: Flag.Boolean("archived").pipe(
      Flag.withDescription("List only archived projects"),
      Flag.withDefault(false),
    ),
    all: Flag.Boolean("all").pipe(
      Flag.withDescription("List both active and archived projects"),
      Flag.withDefault(false),
    ),
    limit: positiveIntFlag("limit", { description: "Page size, max 100", defaultValue: 50 }),
    page: positiveIntFlag("page", { description: "1-based page number", defaultValue: 1 }),
  },
  Effect.fn(function* (args) {
    const api = yield* apiClient;
    const sort = args.sort === "name" ? "name" : "lastActivityAt";
    const { page } = args;
    const { limit } = args;
    const status = listStatus(args.all, args.archived);
    const result = yield* api.projects.list({
      query: {
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
    yield* printHuman(`Page ${result.page} · ${result.items.length} of ${result.total} project(s)`);
  }, runCommand()),
).pipe(Command.withDescription("List projects (most recently active first)"));

const createCommand = Command.make(
  "create",
  {
    name: Flag.String("name").pipe(Flag.withDescription("Display name")),
    slug: Flag.String("slug").pipe(Flag.withDescription("URL-safe slug")),
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Create a new project"));

const getCommand = Command.make(
  "get",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Project ID")),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const project = yield* api.projects.get({ params: { id: args.id } });
      yield* printHumanKeyValue([
        ["ID", project.id],
        ["Name", project.name],
        ["Slug", project.slug],
        ["Status", projectStatus(project.archivedAt)],
        ["Created", project.createdAt],
      ]);
      return project;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Show a project"));

const renameCommand = Command.make(
  "rename",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Project ID")),
    name: Flag.String("name").pipe(Flag.withDescription("New display name")),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const project = yield* api.projects.rename({
        params: { id: args.id },
        payload: { name: args.name },
      });
      yield* printHuman(`Project renamed to "${project.name}".`);
      return project;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Rename a project"));

const archiveCommand = Command.make(
  "archive",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Project ID")),
    yes: yesFlag(),
  },
  Effect.fn(
    function* (args) {
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
      const project = yield* api.projects.archive({ params: { id: args.id } });
      yield* printHuman(
        `Project ${project.name} archived. Unarchive with: projects unarchive ${project.id}`,
      );
      return project;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription("Archive a project (hides it and makes it read-only until unarchived)"),
);

const unarchiveCommand = Command.make(
  "unarchive",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Project ID")),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const project = yield* api.projects.unarchive({ params: { id: args.id } });
      yield* printHuman(`Project ${project.name} unarchived. It is writable again.`);
      return project;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Restore an archived project to active, writable state"));

const deleteCommand = Command.make(
  "delete",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Project ID")),
    yes: yesFlag(),
  },
  Effect.fn(
    function* (args) {
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
      yield* api.projects.delete({ params: { id: args.id } });
      yield* printHuman(`Project ${args.id} deleted.`);
      return { id: args.id, deleted: true };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Delete a project and all its branches, channels, and updates"));

export const projectsCommand = Command.make("projects").pipe(
  Command.withDescription("Manage projects"),
  Command.withSubcommands([
    listCommand,
    createCommand,
    getCommand,
    renameCommand,
    archiveCommand,
    unarchiveCommand,
    deleteCommand,
  ]),
);

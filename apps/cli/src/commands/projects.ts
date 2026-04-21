import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";

import { makeCommandErrorHandler } from "../lib/command-errors";
import { printKeyValue, printTable } from "../lib/output";
import { apiClient } from "../services/api-client";

const handleErrors = makeCommandErrorHandler();

const idArg = Args.text({ name: "id" });
const nameOption = Options.text("name");
const slugOption = Options.text("slug");

const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const { items } = yield* api.projects.list({
      urlParams: { page: 1, limit: 1000 },
    });

    if (items.length === 0) {
      yield* Console.log("No projects found.");
      return;
    }

    yield* printTable(
      ["ID", "Name", "Slug", "Created"],
      items.map((project) => [project.id, project.name, project.slug, project.createdAt]),
    );
  }).pipe(handleErrors),
);

const createCommand = Command.make("create", { name: nameOption, slug: slugOption }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const project = yield* api.projects.create({
      payload: { name: opts.name, slug: opts.slug },
    });
    yield* printKeyValue([
      ["ID", project.id],
      ["Name", project.name],
      ["Slug", project.slug],
      ["Created", project.createdAt],
    ]);
  }).pipe(handleErrors),
);

const getCommand = Command.make("get", { id: idArg }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const project = yield* api.projects.get({ path: { id: opts.id } });
    yield* printKeyValue([
      ["ID", project.id],
      ["Name", project.name],
      ["Slug", project.slug],
      ["Created", project.createdAt],
    ]);
  }).pipe(handleErrors),
);

const renameCommand = Command.make("rename", { id: idArg, name: nameOption }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const project = yield* api.projects.rename({
      path: { id: opts.id },
      payload: { name: opts.name },
    });
    yield* Console.log(`Project renamed to "${project.name}".`);
  }).pipe(handleErrors),
);

const deleteCommand = Command.make("delete", { id: idArg }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    yield* api.projects.delete({ path: { id: opts.id } });
    yield* Console.log(`Project ${opts.id} deleted.`);
  }).pipe(handleErrors),
);

export const projectsCommand = Command.make("projects", {}, () =>
  Console.log("Manage projects. Run with --help for subcommands."),
).pipe(
  Command.withSubcommands([listCommand, createCommand, getCommand, renameCommand, deleteCommand]),
);

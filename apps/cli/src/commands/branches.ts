import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";

import { readProjectId } from "../lib/app-json";
import { makeCommandErrorHandler } from "../lib/command-errors";
import { printKeyValue, printTable } from "../lib/output";
import { apiClient } from "../services/api-client";

const handleErrors = makeCommandErrorHandler();

const idArg = Args.text({ name: "id" });
const nameOption = Options.text("name");

const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;
    const { items } = yield* api.branches.list({
      urlParams: { projectId, page: 1, limit: 1000 },
    });

    if (items.length === 0) {
      yield* Console.log("No branches found.");
      return;
    }

    yield* printTable(
      ["ID", "Name", "Created"],
      items.map((b) => [b.id, b.name, b.createdAt]),
    );
  }).pipe(handleErrors),
);

const createCommand = Command.make("create", { name: nameOption }, (opts) =>
  Effect.gen(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;
    const branch = yield* api.branches.create({
      payload: { projectId, name: opts.name },
    });
    yield* printKeyValue([
      ["ID", branch.id],
      ["Name", branch.name],
      ["Created", branch.createdAt],
    ]);
  }).pipe(handleErrors),
);

const renameCommand = Command.make("rename", { id: idArg, name: nameOption }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const branch = yield* api.branches.rename({
      path: { id: opts.id },
      payload: { name: opts.name },
    });
    yield* Console.log(`Branch renamed to "${branch.name}".`);
  }).pipe(handleErrors),
);

const deleteCommand = Command.make("delete", { id: idArg }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    yield* api.branches.delete({ path: { id: opts.id } });
    yield* Console.log(`Branch ${opts.id} deleted.`);
  }).pipe(handleErrors),
);

export const branchesCommand = Command.make("branches", {}, () =>
  Console.log("Manage branches. Run with --help for subcommands."),
).pipe(Command.withSubcommands([listCommand, createCommand, renameCommand, deleteCommand]));

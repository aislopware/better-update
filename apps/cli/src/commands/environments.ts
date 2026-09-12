import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { printHuman, printKeyValue, printList } from "../lib/output";
import { runCommand } from "../lib/run-command";
import { apiClient } from "../services/api-client";

const listCommand = Command.make(
  "list",
  {},
  Effect.fn(
    function* () {
      const api = yield* apiClient;
      const { items } = yield* api.environments.list();
      yield* printList(
        ["Name", "Built-in"],
        items.map((environment) => [environment.name, environment.isBuiltin ? "yes" : "no"]),
        "No environments found.",
      );
      return items;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("List the organization's environments"));

const createCommand = Command.make(
  "create",
  {
    name: Argument.String("name").pipe(
      Argument.withDescription("Environment name (lowercase letters, digits, hyphens)"),
    ),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const environment = yield* api.environments.create({ payload: { name: args.name } });
      yield* printKeyValue([
        ["Name", environment.name],
        ["Created", environment.createdAt],
      ]);
      return environment;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Create a user-defined environment"));

const renameCommand = Command.make(
  "rename",
  {
    name: Argument.String("name").pipe(Argument.withDescription("Current environment name")),
    to: Flag.String("to").pipe(Flag.withDescription("New environment name")),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const environment = yield* api.environments.rename({
        params: { name: args.name },
        payload: { name: args.to },
      });
      yield* printHuman(`Environment renamed to "${environment.name}".`);
      return environment;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Rename a user-defined environment"));

const deleteCommand = Command.make(
  "delete",
  {
    name: Argument.String("name").pipe(Argument.withDescription("Environment name")),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      yield* api.environments.delete({ params: { name: args.name } });
      yield* printHuman(`Environment "${args.name}" deleted.`);
      return { name: args.name, deleted: true };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Delete a user-defined environment"));

export const environmentsCommand = Command.make("environments").pipe(
  Command.withDescription("Manage organization environments"),
  Command.withSubcommands([listCommand, createCommand, renameCommand, deleteCommand]),
);

import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { drainPages } from "../lib/drain-cursor";
import { InvalidArgumentError } from "../lib/exit-codes";
import { printHuman, printHumanKeyValue, printKeyValue, printList } from "../lib/output";
import { readProjectId } from "../lib/project-link";
import { runCommand } from "../lib/run-command";
import { apiClient } from "../services/api-client";

const listCommand = Command.make(
  "list",
  {},
  Effect.fn(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;
    const items = yield* drainPages((page) =>
      api.branches.list({
        query: { projectId, limit: 100, page },
      }),
    );

    yield* printList(
      ["ID", "Name", "Created"],
      items.map((branch) => [branch.id, branch.name, branch.createdAt]),
      "No branches found.",
    );
  }, runCommand()),
).pipe(Command.withDescription("List branches for the linked project"));

const createCommand = Command.make(
  "create",
  {
    name: Flag.String("name").pipe(Flag.withDescription("Branch name")),
  },
  Effect.fn(function* (args) {
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
  }, runCommand()),
).pipe(Command.withDescription("Create a branch"));

const viewCommand = Command.make(
  "view",
  {
    target: Argument.String("target").pipe(
      Argument.withDescription("Branch ID or branch name (name requires linked project)"),
    ),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const branch = yield* api.branches.get({ params: { id: args.target } }).pipe(
        Effect.catchTag("NotFound", () =>
          Effect.gen(function* () {
            const projectId = yield* readProjectId;
            const matches = yield* drainPages((page) =>
              api.branches.list({
                query: { projectId, limit: 100, page },
              }),
            );
            const byName = matches.find((entry) => entry.name === args.target);
            if (!byName) {
              return yield* new InvalidArgumentError({
                message: `Branch "${args.target}" not found by ID or name.`,
              });
            }
            return byName;
          }),
        ),
      );

      yield* printHumanKeyValue([
        ["ID", branch.id],
        ["Name", branch.name],
        ["Project ID", branch.projectId],
        ["Updates", String(branch.updateCount)],
        ["Created", branch.createdAt],
      ]);
      return branch;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Show a branch by ID or name"));

const renameCommand = Command.make(
  "rename",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Branch ID")),
    name: Flag.String("name").pipe(Flag.withDescription("New branch name")),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const branch = yield* api.branches.rename({
        params: { id: args.id },
        payload: { name: args.name },
      });
      yield* printHuman(`Branch renamed to "${branch.name}".`);
      return branch;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Rename a branch"));

const deleteCommand = Command.make(
  "delete",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Branch ID")),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      yield* api.branches.delete({ params: { id: args.id } });
      yield* printHuman(`Branch ${args.id} deleted.`);
      return { id: args.id, deleted: true };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Delete a branch"));

export const branchesCommand = Command.make("branches").pipe(
  Command.withDescription("Manage branches"),
  Command.withSubcommands([listCommand, viewCommand, createCommand, renameCommand, deleteCommand]),
);

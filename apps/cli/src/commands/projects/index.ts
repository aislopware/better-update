import { Command } from "@effect/cli";
import { Console } from "effect";

import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { getCommand } from "./get";
import { listCommand } from "./list";
import { renameCommand } from "./rename";

export const projectsCommand = Command.make("projects", {}, () =>
  Console.log("Manage projects. Run with --help for subcommands."),
).pipe(
  Command.withSubcommands([listCommand, createCommand, getCommand, renameCommand, deleteCommand]),
);

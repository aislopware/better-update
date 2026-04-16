import { Command } from "@effect/cli";
import { Console } from "effect";

import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { listCommand } from "./list";
import { renameCommand } from "./rename";

export const branchesCommand = Command.make("branches", {}, () =>
  Console.log("Manage branches. Run with --help for subcommands."),
).pipe(Command.withSubcommands([listCommand, createCommand, renameCommand, deleteCommand]));

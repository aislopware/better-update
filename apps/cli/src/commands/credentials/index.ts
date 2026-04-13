import { Command } from "@effect/cli";
import { Console } from "effect";

import { activateCommand } from "./activate";
import { deleteCommand } from "./delete";
import { listCommand } from "./list";
import { uploadCommand } from "./upload";

export const credentialsCommand = Command.make("credentials", {}, () =>
  Console.log("Manage credentials. Run with --help for subcommands."),
).pipe(Command.withSubcommands([listCommand, uploadCommand, activateCommand, deleteCommand]));

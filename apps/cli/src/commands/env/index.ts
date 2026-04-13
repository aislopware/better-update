import { Command } from "@effect/cli";
import { Console } from "effect";

import { deleteCommand } from "./delete";
import { exportCommand } from "./export";
import { importCommand } from "./import";
import { listCommand } from "./list";
import { pullCommand } from "./pull";
import { setCommand } from "./set";

export const envCommand = Command.make("env", {}, () =>
  Console.log("Manage environment variables. Run with --help for subcommands."),
).pipe(
  Command.withSubcommands([
    listCommand,
    setCommand,
    deleteCommand,
    importCommand,
    exportCommand,
    pullCommand,
  ]),
);

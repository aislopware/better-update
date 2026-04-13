import { Command } from "@effect/cli";
import { Console } from "effect";

import { publishCommand } from "./publish";

export const updateCommand = Command.make("update", {}, () =>
  Console.log("Manage OTA updates. Run with --help for subcommands."),
).pipe(Command.withSubcommands([publishCommand]));

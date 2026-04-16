import { Command } from "@effect/cli";
import { Console } from "effect";

import { compareCommand } from "./compare";
import { generateCommand } from "./generate";

export const fingerprintCommand = Command.make("fingerprint", {}, () =>
  Console.log("Fingerprint utilities. Use --help for subcommands."),
).pipe(Command.withSubcommands([generateCommand, compareCommand]));

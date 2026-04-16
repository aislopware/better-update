import { Command } from "@effect/cli";
import { Console } from "effect";

import { completeCommand } from "./complete";
import { createCommand } from "./create";
import { revertCommand } from "./revert";
import { updateCommand } from "./update";

export const rolloutCommand = Command.make("rollout", {}, () =>
  Console.log("Manage channel branch rollouts. Run with --help for subcommands."),
).pipe(Command.withSubcommands([createCommand, updateCommand, completeCommand, revertCommand]));

import { Command } from "@effect/cli";
import { Console } from "effect";

import { completeCommand } from "./complete";
import { revertCommand } from "./revert";
import { setCommand } from "./set";

export const rolloutCommand = Command.make("rollout", {}, () =>
  Console.log("Manage per-update rollouts. Run with --help for subcommands."),
).pipe(Command.withSubcommands([setCommand, completeCommand, revertCommand]));

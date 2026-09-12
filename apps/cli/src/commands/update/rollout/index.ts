import { Command } from "effect/unstable/cli";

import { completeCommand } from "./complete";
import { revertCommand } from "./revert";
import { setCommand } from "./set";

export const rolloutCommand = Command.make("rollout").pipe(
  Command.withDescription("Manage per-update rollouts"),
  Command.withSubcommands([setCommand, completeCommand, revertCommand]),
);

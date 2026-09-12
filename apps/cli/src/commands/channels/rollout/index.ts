import { Command } from "effect/unstable/cli";

import { completeCommand } from "./complete";
import { createCommand } from "./create";
import { revertCommand } from "./revert";
import { updateCommand } from "./update";

export const rolloutCommand = Command.make("rollout").pipe(
  Command.withDescription("Manage channel branch rollouts"),
  Command.withSubcommands([createCommand, updateCommand, completeCommand, revertCommand]),
);

import { Command } from "effect/unstable/cli";

import { rolloutCompleteCommand } from "./complete";
import { rolloutPauseCommand } from "./pause";
import { rolloutResumeCommand } from "./resume";
import { rolloutStartCommand } from "./start";
import { rolloutStatusCommand } from "./status";

export const appStoreRolloutCommand = Command.make("rollout").pipe(
  Command.withDescription(
    "Manage a phased (staged) release: start, status, pause, resume, complete",
  ),
  Command.withSubcommands([
    rolloutStartCommand,
    rolloutStatusCommand,
    rolloutPauseCommand,
    rolloutResumeCommand,
    rolloutCompleteCommand,
  ]),
);

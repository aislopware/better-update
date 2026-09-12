import { Command } from "effect/unstable/cli";

import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { insightsCommand } from "./insights";
import { listCommand } from "./list";
import { pauseCommand } from "./pause";
import { resumeCommand } from "./resume";
import { rolloutCommand } from "./rollout";
import { updateCommand } from "./update";
import { viewCommand } from "./view";

export const channelsCommand = Command.make("channels").pipe(
  Command.withDescription("Manage channels"),
  Command.withSubcommands([
    listCommand,
    viewCommand,
    createCommand,
    updateCommand,
    pauseCommand,
    resumeCommand,
    deleteCommand,
    rolloutCommand,
    insightsCommand,
  ]),
);

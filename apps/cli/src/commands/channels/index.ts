import { Command } from "@effect/cli";
import { Console } from "effect";

import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { listCommand } from "./list";
import { pauseCommand } from "./pause";
import { resumeCommand } from "./resume";
import { rolloutCommand } from "./rollout";
import { updateCommand } from "./update";

export const channelsCommand = Command.make("channels", {}, () =>
  Console.log("Manage channels. Run with --help for subcommands."),
).pipe(
  Command.withSubcommands([
    listCommand,
    createCommand,
    updateCommand,
    pauseCommand,
    resumeCommand,
    deleteCommand,
    rolloutCommand,
  ]),
);

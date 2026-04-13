import { Command } from "@effect/cli";
import { Console } from "effect";

import { deleteCommand } from "./delete";
import { listCommand } from "./list";
import { promoteCommand } from "./promote";
import { publishCommand } from "./publish";
import { rolloutCommand } from "./rollout";

export const updateCommand = Command.make("update", {}, () =>
  Console.log("Manage OTA updates. Run with --help for subcommands."),
).pipe(
  Command.withSubcommands([
    publishCommand,
    listCommand,
    deleteCommand,
    promoteCommand,
    rolloutCommand,
  ]),
);

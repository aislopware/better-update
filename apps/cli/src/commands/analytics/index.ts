import { Command } from "@effect/cli";
import { Console } from "effect";

import { adoptionCommand } from "./adoption";
import { channelsCommand } from "./channels";
import { platformsCommand } from "./platforms";
import { updatesCommand } from "./updates";

export const analyticsCommand = Command.make("analytics", {}, () =>
  Console.log("View deployment analytics. Run with --help for subcommands."),
).pipe(
  Command.withSubcommands([adoptionCommand, updatesCommand, channelsCommand, platformsCommand]),
);

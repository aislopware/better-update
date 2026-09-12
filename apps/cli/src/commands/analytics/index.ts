import { Command } from "effect/unstable/cli";

import { adoptionCommand } from "./adoption";
import { channelsCommand } from "./channels";
import { downloadsCommand } from "./downloads";
import { platformsCommand } from "./platforms";
import { updatesCommand } from "./updates";

export const analyticsCommand = Command.make("analytics").pipe(
  Command.withDescription("View deployment analytics"),
  Command.withSubcommands([
    adoptionCommand,
    updatesCommand,
    downloadsCommand,
    channelsCommand,
    platformsCommand,
  ]),
);

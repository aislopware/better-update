import { Command } from "effect/unstable/cli";

import { pullCommand } from "./pull";
import { pushCommand } from "./push";

export const syncCommand = Command.make("sync").pipe(
  Command.withDescription("Sync credentials between local credentials.json and the server"),
  Command.withSubcommands([pushCommand, pullCommand]),
);

import { Command } from "effect/unstable/cli";

import { configPullCommand } from "./pull";
import { configPushCommand } from "./push";

export const appStoreConfigCommand = Command.make("config").pipe(
  Command.withDescription(
    "Pull/push the editable version's per-locale copy as a JSON document (eas-metadata parity)",
  ),
  Command.withSubcommands([configPullCommand, configPushCommand]),
);

import { Command } from "effect/unstable/cli";

import { ascKeyListCommand } from "./list";

export const appleAscKeyCommand = Command.make("asc-key").pipe(
  Command.withDescription(
    "Inspect upstream App Store Connect API keys on Apple (Apple ID login). Create via `credentials generate asc-key`, revoke via `credentials revoke asc-key`.",
  ),
  Command.withSubcommands([ascKeyListCommand]),
);

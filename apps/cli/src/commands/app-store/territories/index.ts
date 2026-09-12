import { Command } from "effect/unstable/cli";

import { territoriesListCommand } from "./list";

export const appStoreTerritoriesCommand = Command.make("territories").pipe(
  Command.withDescription("List App Store territories (reference ids for availability)"),
  Command.withSubcommands([territoriesListCommand]),
);

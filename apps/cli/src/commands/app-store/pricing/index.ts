import { Command } from "effect/unstable/cli";

import { pricingShowCommand } from "./show";

export const appStorePricingCommand = Command.make("pricing").pipe(
  Command.withDescription("Inspect the app's App Store pricing"),
  Command.withSubcommands([pricingShowCommand]),
);

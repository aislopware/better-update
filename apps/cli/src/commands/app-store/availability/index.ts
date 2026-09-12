import { Command } from "effect/unstable/cli";

import { availabilitySetCommand } from "./set";
import { availabilityShowCommand } from "./show";

export const appStoreAvailabilityCommand = Command.make("availability").pipe(
  Command.withDescription("Inspect + set the app's territory availability"),
  Command.withSubcommands([availabilityShowCommand, availabilitySetCommand]),
);

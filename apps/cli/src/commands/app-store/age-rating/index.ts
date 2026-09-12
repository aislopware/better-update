import { Command } from "effect/unstable/cli";

import { ageRatingGetCommand } from "./get";
import { ageRatingSetCommand } from "./set";

export const appStoreAgeRatingCommand = Command.make("age-rating").pipe(
  Command.withDescription("Read or set the app's age-rating content declaration"),
  Command.withSubcommands([ageRatingGetCommand, ageRatingSetCommand]),
);

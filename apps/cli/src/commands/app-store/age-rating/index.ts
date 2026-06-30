import { defineCommand } from "citty";

import { ageRatingGetCommand } from "./get";
import { ageRatingSetCommand } from "./set";

export const appStoreAgeRatingCommand = defineCommand({
  meta: {
    name: "age-rating",
    description: "Read or set the app's age-rating content declaration",
  },
  subCommands: {
    get: ageRatingGetCommand,
    set: ageRatingSetCommand,
  },
});

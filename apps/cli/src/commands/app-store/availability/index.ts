import { defineCommand } from "citty";

import { availabilitySetCommand } from "./set";
import { availabilityShowCommand } from "./show";

export const appStoreAvailabilityCommand = defineCommand({
  meta: {
    name: "availability",
    description: "Inspect + set the app's territory availability",
  },
  subCommands: {
    show: availabilityShowCommand,
    set: availabilitySetCommand,
  },
});

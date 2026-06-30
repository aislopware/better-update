import { defineCommand } from "citty";

import { availabilityShowCommand } from "./show";

export const appStoreAvailabilityCommand = defineCommand({
  meta: {
    name: "availability",
    description: "Inspect the app's territory availability",
  },
  subCommands: {
    show: availabilityShowCommand,
  },
});

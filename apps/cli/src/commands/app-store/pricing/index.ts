import { defineCommand } from "citty";

import { pricingShowCommand } from "./show";

export const appStorePricingCommand = defineCommand({
  meta: {
    name: "pricing",
    description: "Inspect the app's App Store pricing",
  },
  subCommands: {
    show: pricingShowCommand,
  },
});

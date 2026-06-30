import { defineCommand } from "citty";

import { appsCreateCommand } from "./create";
import { appsListCommand } from "./list";

export const appStoreAppsCommand = defineCommand({
  meta: {
    name: "apps",
    description: "Inspect + register the app records on your App Store Connect account",
  },
  subCommands: {
    list: appsListCommand,
    create: appsCreateCommand,
  },
});

import { defineCommand } from "citty";

import { appsListCommand } from "./list";

export const appStoreAppsCommand = defineCommand({
  meta: {
    name: "apps",
    description: "Inspect the app records on your App Store Connect account",
  },
  subCommands: {
    list: appsListCommand,
  },
});

import { defineCommand } from "citty";

import { bundleIdListCommand } from "./list";

export const bundleIdCommand = defineCommand({
  meta: {
    name: "bundle-id",
    description: "Inspect App IDs (bundle ids) on App Store Connect",
  },
  subCommands: {
    list: bundleIdListCommand,
  },
});

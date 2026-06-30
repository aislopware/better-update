import { defineCommand } from "citty";

import { bundleIdCreateCommand } from "./create";
import { bundleIdListCommand } from "./list";

export const bundleIdCommand = defineCommand({
  meta: {
    name: "bundle-id",
    description: "Inspect + register App IDs (bundle ids) on App Store Connect",
  },
  subCommands: {
    list: bundleIdListCommand,
    create: bundleIdCreateCommand,
  },
});

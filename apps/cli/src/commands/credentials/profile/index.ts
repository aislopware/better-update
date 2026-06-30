import { defineCommand } from "citty";

import { profileListCommand } from "./list";

export const profileCommand = defineCommand({
  meta: {
    name: "profile",
    description: "Inspect provisioning profiles on App Store Connect",
  },
  subCommands: {
    list: profileListCommand,
  },
});

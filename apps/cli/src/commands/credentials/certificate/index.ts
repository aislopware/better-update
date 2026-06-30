import { defineCommand } from "citty";

import { certificateListCommand } from "./list";

export const certificateCommand = defineCommand({
  meta: {
    name: "certificate",
    description: "Inspect signing certificates on App Store Connect",
  },
  subCommands: {
    list: certificateListCommand,
  },
});

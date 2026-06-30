import { defineCommand } from "citty";

import { capabilityEnableCommand } from "./enable";
import { capabilityListCommand } from "./list";

export const capabilityCommand = defineCommand({
  meta: {
    name: "capability",
    description: "Inspect and enable App ID capabilities on App Store Connect",
  },
  subCommands: {
    list: capabilityListCommand,
    enable: capabilityEnableCommand,
  },
});

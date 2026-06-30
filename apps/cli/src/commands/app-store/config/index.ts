import { defineCommand } from "citty";

import { configPullCommand } from "./pull";
import { configPushCommand } from "./push";

export const appStoreConfigCommand = defineCommand({
  meta: {
    name: "config",
    description:
      "Pull/push the editable version's per-locale copy as a JSON document (eas-metadata parity)",
  },
  subCommands: {
    pull: configPullCommand,
    push: configPushCommand,
  },
});

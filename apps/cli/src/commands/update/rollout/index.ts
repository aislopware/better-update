import { defineCommand } from "citty";

import { completeCommand } from "./complete";
import { revertCommand } from "./revert";
import { setCommand } from "./set";

export const rolloutCommand = defineCommand({
  meta: { name: "rollout", description: "Manage per-update rollouts" },
  subCommands: {
    set: setCommand,
    complete: completeCommand,
    revert: revertCommand,
  },
});

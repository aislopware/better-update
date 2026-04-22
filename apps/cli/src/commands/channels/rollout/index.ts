import { defineCommand } from "citty";

import { completeCommand } from "./complete";
import { createCommand } from "./create";
import { revertCommand } from "./revert";
import { updateCommand } from "./update";

export const rolloutCommand = defineCommand({
  meta: { name: "rollout", description: "Manage channel branch rollouts" },
  subCommands: {
    create: createCommand,
    update: updateCommand,
    complete: completeCommand,
    revert: revertCommand,
  },
});

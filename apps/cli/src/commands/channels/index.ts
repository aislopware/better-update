import { defineCommand } from "citty";

import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { listCommand } from "./list";
import { pauseCommand } from "./pause";
import { resumeCommand } from "./resume";
import { rolloutCommand } from "./rollout";
import { updateCommand } from "./update";

export const channelsCommand = defineCommand({
  meta: { name: "channels", description: "Manage channels" },
  subCommands: {
    list: listCommand,
    create: createCommand,
    update: updateCommand,
    pause: pauseCommand,
    resume: resumeCommand,
    delete: deleteCommand,
    rollout: rolloutCommand,
  },
});

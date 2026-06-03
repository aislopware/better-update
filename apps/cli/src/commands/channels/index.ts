import { defineCommand } from "citty";

import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { grantsCommand } from "./grants";
import { insightsCommand } from "./insights";
import { listCommand } from "./list";
import { pauseCommand } from "./pause";
import { resumeCommand } from "./resume";
import { rolloutCommand } from "./rollout";
import { updateCommand } from "./update";
import { viewCommand } from "./view";

export const channelsCommand = defineCommand({
  meta: { name: "channels", description: "Manage channels" },
  subCommands: {
    list: listCommand,
    view: viewCommand,
    create: createCommand,
    update: updateCommand,
    pause: pauseCommand,
    resume: resumeCommand,
    delete: deleteCommand,
    rollout: rolloutCommand,
    grants: grantsCommand,
    insights: insightsCommand,
  },
});

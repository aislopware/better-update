import { defineCommand } from "citty";

import { configureCommand } from "./configure";
import { deleteCommand } from "./delete";
import { editCommand } from "./edit";
import { insightsCommand } from "./insights";
import { listCommand } from "./list";
import { promoteCommand } from "./promote";
import { publishCommand } from "./publish";
import { republishCommand } from "./republish";
import { revertRolloutCommand } from "./revert-rollout";
import { rollbackCommand, rollBackToEmbeddedCommand } from "./rollback";
import { rolloutCommand } from "./rollout";
import { viewCommand } from "./view";

export const updateCommand = defineCommand({
  meta: { name: "update", description: "Manage OTA updates" },
  subCommands: {
    publish: publishCommand,
    configure: configureCommand,
    list: listCommand,
    view: viewCommand,
    delete: deleteCommand,
    edit: editCommand,
    promote: promoteCommand,
    republish: republishCommand,
    rollback: rollbackCommand,
    "roll-back-to-embedded": rollBackToEmbeddedCommand,
    rollout: rolloutCommand,
    "revert-rollout": revertRolloutCommand,
    insights: insightsCommand,
  },
});

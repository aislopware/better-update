import { defineCommand } from "citty";

import { configureCommand } from "./configure";
import { deleteCommand } from "./delete";
import { editCommand } from "./edit";
import { embeddedUploadCommand } from "./embedded-upload";
import { insightsCommand } from "./insights";
import { listCommand } from "./list";
import { promoteCommand } from "./promote";
import { publishCommand } from "./publish";
import { republishCommand } from "./republish";
import { revertCommand } from "./revert";
import { revertRolloutCommand } from "./revert-rollout";
import { rollbackCommand, rollBackToEmbeddedCommand } from "./rollback";
import { rolloutCommand } from "./rollout";
import { sourcemapCommand } from "./sourcemap";
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
    "embedded:upload": embeddedUploadCommand,
    promote: promoteCommand,
    republish: republishCommand,
    rollback: rollbackCommand,
    "roll-back-to-embedded": rollBackToEmbeddedCommand,
    revert: revertCommand,
    rollout: rolloutCommand,
    "revert-rollout": revertRolloutCommand,
    insights: insightsCommand,
    sourcemap: sourcemapCommand,
  },
});

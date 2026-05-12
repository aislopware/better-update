import { defineCommand } from "citty";

import { deleteCommand } from "./delete";
import { listCommand } from "./list";
import { promoteCommand } from "./promote";
import { publishCommand } from "./publish";
import { republishCommand } from "./republish";
import { rollbackCommand } from "./rollback";
import { rolloutCommand } from "./rollout";
import { viewCommand } from "./view";

export const updateCommand = defineCommand({
  meta: { name: "update", description: "Manage OTA updates" },
  subCommands: {
    publish: publishCommand,
    list: listCommand,
    view: viewCommand,
    delete: deleteCommand,
    promote: promoteCommand,
    republish: republishCommand,
    rollback: rollbackCommand,
    rollout: rolloutCommand,
  },
});

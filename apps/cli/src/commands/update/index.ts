import { defineCommand } from "citty";

import { deleteCommand } from "./delete";
import { listCommand } from "./list";
import { promoteCommand } from "./promote";
import { publishCommand } from "./publish";
import { rollbackCommand } from "./rollback";
import { rolloutCommand } from "./rollout";

export const updateCommand = defineCommand({
  meta: { name: "update", description: "Manage OTA updates" },
  subCommands: {
    publish: publishCommand,
    list: listCommand,
    delete: deleteCommand,
    promote: promoteCommand,
    rollback: rollbackCommand,
    rollout: rolloutCommand,
  },
});

import { defineCommand } from "citty";

import { pullCommand } from "./pull";
import { pushCommand } from "./push";

export const syncCommand = defineCommand({
  meta: {
    name: "sync",
    description: "Sync credentials between local credentials.json and the server",
  },
  subCommands: {
    push: pushCommand,
    pull: pullCommand,
  },
});

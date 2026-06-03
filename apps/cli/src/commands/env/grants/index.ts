import { defineCommand } from "citty";

import { listCommand } from "./list";
import { setCommand } from "./set";
import { unsetCommand } from "./unset";

export const grantsCommand = defineCommand({
  meta: {
    name: "grants",
    description: "Manage per-member env-var access grants on a (project × environment) scope",
  },
  subCommands: {
    list: listCommand,
    set: setCommand,
    unset: unsetCommand,
  },
});

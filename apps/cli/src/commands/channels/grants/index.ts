import { defineCommand } from "citty";

import { listCommand } from "./list";
import { revokeCommand } from "./revoke";
import { setCommand } from "./set";

export const grantsCommand = defineCommand({
  meta: { name: "grants", description: "Manage per-member permission grants on a channel" },
  subCommands: {
    list: listCommand,
    set: setCommand,
    revoke: revokeCommand,
  },
});

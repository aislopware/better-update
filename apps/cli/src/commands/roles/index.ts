import { defineCommand } from "citty";

import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { listCommand } from "./list";
import { updateCommand } from "./update";
import { viewCommand } from "./view";

export const rolesCommand = defineCommand({
  meta: { name: "roles", description: "Manage custom organization roles" },
  subCommands: {
    list: listCommand,
    view: viewCommand,
    create: createCommand,
    update: updateCommand,
    delete: deleteCommand,
  },
});

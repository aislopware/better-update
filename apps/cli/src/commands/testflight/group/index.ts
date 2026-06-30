import { defineCommand } from "citty";

import { groupCreateCommand } from "./create";
import { groupDeleteCommand } from "./delete";
import { groupListCommand } from "./list";

export const testflightGroupCommand = defineCommand({
  meta: {
    name: "group",
    description: "Manage TestFlight beta groups (list, create, delete)",
  },
  subCommands: {
    list: groupListCommand,
    create: groupCreateCommand,
    delete: groupDeleteCommand,
  },
});

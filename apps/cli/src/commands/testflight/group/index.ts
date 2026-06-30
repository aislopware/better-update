import { defineCommand } from "citty";

import { groupAddBuildCommand } from "./add-build";
import { groupCreateCommand } from "./create";
import { groupDeleteCommand } from "./delete";
import { groupListCommand } from "./list";

export const testflightGroupCommand = defineCommand({
  meta: {
    name: "group",
    description: "Manage TestFlight beta groups (list, create, delete, add-build)",
  },
  subCommands: {
    list: groupListCommand,
    create: groupCreateCommand,
    delete: groupDeleteCommand,
    "add-build": groupAddBuildCommand,
  },
});

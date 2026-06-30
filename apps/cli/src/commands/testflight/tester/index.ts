import { defineCommand } from "citty";

import { testerAddCommand } from "./add";
import { testerImportCommand } from "./import";
import { testerListCommand } from "./list";
import { testerRemoveCommand } from "./remove";

export const testflightTesterCommand = defineCommand({
  meta: {
    name: "tester",
    description: "Manage TestFlight beta testers (list, add, import, remove)",
  },
  subCommands: {
    list: testerListCommand,
    add: testerAddCommand,
    import: testerImportCommand,
    remove: testerRemoveCommand,
  },
});

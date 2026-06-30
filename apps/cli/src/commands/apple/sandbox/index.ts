import { defineCommand } from "citty";

import { sandboxCreateCommand } from "./create";
import { sandboxDeleteCommand } from "./delete";
import { sandboxListCommand } from "./list";

export const appleSandboxCommand = defineCommand({
  meta: {
    name: "sandbox",
    description: "Manage App Store sandbox testers for IAP testing (Apple ID login)",
  },
  subCommands: {
    list: sandboxListCommand,
    create: sandboxCreateCommand,
    delete: sandboxDeleteCommand,
  },
});

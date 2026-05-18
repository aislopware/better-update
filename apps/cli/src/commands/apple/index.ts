import { defineCommand } from "citty";

import { appleLoginCommand } from "./login";
import { appleLogoutCommand } from "./logout";
import { appleWhoamiCommand } from "./whoami";

export const appleCommand = defineCommand({
  meta: {
    name: "apple",
    description: "Manage your Apple Developer session (used for issuing iOS credentials)",
  },
  subCommands: {
    login: appleLoginCommand,
    logout: appleLogoutCommand,
    whoami: appleWhoamiCommand,
  },
});

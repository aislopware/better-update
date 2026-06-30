import { defineCommand } from "citty";

import { appleBuildsCommand } from "./builds";
import { appleLoginCommand } from "./login";
import { appleLogoutCommand } from "./logout";
import { appleUsersCommand } from "./users";
import { appleWhoamiCommand } from "./whoami";

export const appleCommand = defineCommand({
  meta: {
    name: "apple",
    description:
      "Manage your Apple Developer session + App Store Connect account operations (builds, users)",
  },
  subCommands: {
    login: appleLoginCommand,
    logout: appleLogoutCommand,
    whoami: appleWhoamiCommand,
    builds: appleBuildsCommand,
    users: appleUsersCommand,
  },
});

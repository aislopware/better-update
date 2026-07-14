import { defineCommand } from "citty";

import { appleAccountsCommand } from "./accounts";
import { appleAscKeyCommand } from "./asc-key";
import { appleBuildsCommand } from "./builds";
import { appleLoginCommand } from "./login";
import { appleLogoutCommand } from "./logout";
import { appleSandboxCommand } from "./sandbox";
import { appleUsersCommand } from "./users";
import { appleWhoamiCommand } from "./whoami";

export const appleCommand = defineCommand({
  meta: {
    name: "apple",
    description:
      "Manage your Apple Developer session + App Store Connect account operations (builds, users, sandbox)",
  },
  subCommands: {
    login: appleLoginCommand,
    logout: appleLogoutCommand,
    whoami: appleWhoamiCommand,
    accounts: appleAccountsCommand,
    builds: appleBuildsCommand,
    users: appleUsersCommand,
    "asc-key": appleAscKeyCommand,
    sandbox: appleSandboxCommand,
  },
});

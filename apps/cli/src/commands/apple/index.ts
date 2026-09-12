import { Command } from "effect/unstable/cli";

import { applePortalExitCodes } from "../../lib/command-errors";
import { appleAccountsCommand } from "./accounts";
import { appleAscKeyCommand } from "./asc-key";
import { appleBuildsCommand } from "./builds";
import { appleLoginCommand } from "./login";
import { appleLogoutCommand } from "./logout";
import { appleSandboxCommand } from "./sandbox";
import { appleUsersCommand } from "./users";
import { appleWhoamiCommand } from "./whoami";

export const appleCommand = Command.make("apple").pipe(
  Command.withDescription(
    "Manage your Apple Developer session + App Store Connect account operations (builds, users, sandbox)",
  ),
  Command.withSubcommands([
    appleLoginCommand,
    appleLogoutCommand,
    appleWhoamiCommand,
    appleAccountsCommand,
    appleBuildsCommand,
    appleUsersCommand,
    appleAscKeyCommand,
    appleSandboxCommand,
  ]),
  Command.provide(applePortalExitCodes),
);

import { Command } from "effect/unstable/cli";

import { accountsListCommand } from "./list";
import { accountsSwitchCommand } from "./switch";

export const appleAccountsCommand = Command.make("accounts").pipe(
  Command.withDescription(
    "Manage cached Apple Developer accounts (multiple logins, switch without re-auth)",
  ),
  Command.withSubcommands([accountsListCommand, accountsSwitchCommand]),
);

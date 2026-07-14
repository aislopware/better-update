import { defineCommand } from "citty";

import { accountsListCommand } from "./list";
import { accountsSwitchCommand } from "./switch";

export const appleAccountsCommand = defineCommand({
  meta: {
    name: "accounts",
    description: "Manage cached Apple Developer accounts (multiple logins, switch without re-auth)",
  },
  subCommands: {
    list: accountsListCommand,
    switch: accountsSwitchCommand,
  },
});

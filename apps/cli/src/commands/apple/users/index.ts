import { defineCommand } from "citty";

import { usersInviteCommand } from "./invite";
import { usersListCommand } from "./list";

export const appleUsersCommand = defineCommand({
  meta: {
    name: "users",
    description: "Manage App Store Connect team users (CI-safe; needs an Admin-role key)",
  },
  subCommands: {
    list: usersListCommand,
    invite: usersInviteCommand,
  },
});

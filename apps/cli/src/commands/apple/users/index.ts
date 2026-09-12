import { Command } from "effect/unstable/cli";

import { usersInviteCommand } from "./invite";
import { usersListCommand } from "./list";

export const appleUsersCommand = Command.make("users").pipe(
  Command.withDescription("Manage App Store Connect team users (CI-safe; needs an Admin-role key)"),
  Command.withSubcommands([usersListCommand, usersInviteCommand]),
);

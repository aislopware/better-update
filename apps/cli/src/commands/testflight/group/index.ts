import { Command } from "effect/unstable/cli";

import { groupAddBuildCommand } from "./add-build";
import { groupCreateCommand } from "./create";
import { groupDeleteCommand } from "./delete";
import { groupListCommand } from "./list";

export const testflightGroupCommand = Command.make("group").pipe(
  Command.withDescription("Manage TestFlight beta groups (list, create, delete, add-build)"),
  Command.withSubcommands([
    groupListCommand,
    groupCreateCommand,
    groupDeleteCommand,
    groupAddBuildCommand,
  ]),
);

import { Command } from "effect/unstable/cli";

import { testerAddCommand } from "./add";
import { testerImportCommand } from "./import";
import { testerListCommand } from "./list";
import { testerRemoveCommand } from "./remove";

export const testflightTesterCommand = Command.make("tester").pipe(
  Command.withDescription("Manage TestFlight beta testers (list, add, import, remove)"),
  Command.withSubcommands([
    testerListCommand,
    testerAddCommand,
    testerImportCommand,
    testerRemoveCommand,
  ]),
);

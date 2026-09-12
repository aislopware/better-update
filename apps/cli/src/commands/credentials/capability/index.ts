import { Command } from "effect/unstable/cli";

import { applePortalExitCodes } from "../../../lib/command-errors";
import { capabilityEnableCommand } from "./enable";
import { capabilityListCommand } from "./list";

export const capabilityCommand = Command.make("capability").pipe(
  Command.withDescription("Inspect and enable App ID capabilities on App Store Connect"),
  Command.withSubcommands([capabilityListCommand, capabilityEnableCommand]),
  Command.provide(applePortalExitCodes),
);

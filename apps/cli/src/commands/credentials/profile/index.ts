import { Command } from "effect/unstable/cli";

import { applePortalExitCodes } from "../../../lib/command-errors";
import { profileListCommand } from "./list";

export const profileCommand = Command.make("profile").pipe(
  Command.withDescription("Inspect provisioning profiles on App Store Connect"),
  Command.withSubcommands([profileListCommand]),
  Command.provide(applePortalExitCodes),
);

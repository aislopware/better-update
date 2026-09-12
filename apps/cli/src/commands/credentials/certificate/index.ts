import { Command } from "effect/unstable/cli";

import { applePortalExitCodes } from "../../../lib/command-errors";
import { certificateListCommand } from "./list";

export const certificateCommand = Command.make("certificate").pipe(
  Command.withDescription("Inspect signing certificates on App Store Connect"),
  Command.withSubcommands([certificateListCommand]),
  Command.provide(applePortalExitCodes),
);

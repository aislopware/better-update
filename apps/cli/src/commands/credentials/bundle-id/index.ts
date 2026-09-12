import { Command } from "effect/unstable/cli";

import { applePortalExitCodes } from "../../../lib/command-errors";
import { bundleIdCreateCommand } from "./create";
import { bundleIdListCommand } from "./list";

export const bundleIdCommand = Command.make("bundle-id").pipe(
  Command.withDescription("Inspect + register App IDs (bundle ids) on App Store Connect"),
  Command.withSubcommands([bundleIdListCommand, bundleIdCreateCommand]),
  Command.provide(applePortalExitCodes),
);

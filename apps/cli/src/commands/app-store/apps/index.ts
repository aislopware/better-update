import { Command } from "effect/unstable/cli";

import { appsCreateCommand } from "./create";
import { appsListCommand } from "./list";

export const appStoreAppsCommand = Command.make("apps").pipe(
  Command.withDescription("Inspect + register the app records on your App Store Connect account"),
  Command.withSubcommands([appsListCommand, appsCreateCommand]),
);

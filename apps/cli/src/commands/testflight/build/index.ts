import { Command } from "effect/cli";

import { buildWhatsNewCommand } from "./whats-new";

export const testflightBuildCommand = Command.make("build").pipe(
  Command.withDescription("Manage TestFlight build metadata (what's-new / 'What to Test')"),
  Command.withSubcommands([buildWhatsNewCommand]),
);

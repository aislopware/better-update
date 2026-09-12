import { Command } from "effect/unstable/cli";

import { buildsComplianceCommand } from "./compliance";
import { buildsGetCommand } from "./get";
import { buildsListCommand } from "./list";
import { buildsStatusCommand } from "./status";

export const appleBuildsCommand = Command.make("builds").pipe(
  Command.withDescription(
    "Inspect App Store Connect builds and answer export compliance (CI-safe)",
  ),
  Command.withSubcommands([
    buildsListCommand,
    buildsGetCommand,
    buildsStatusCommand,
    buildsComplianceCommand,
  ]),
);

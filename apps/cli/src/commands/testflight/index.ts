import { Command } from "effect/unstable/cli";

import { applePortalExitCodes } from "../../lib/command-errors";
import { testflightBuildCommand } from "./build";
import { testflightFeedbackCommand } from "./feedback";
import { testflightGroupCommand } from "./group";
import { testflightReviewCommand } from "./review";
import { testflightTesterCommand } from "./tester";

export const testflightCommand = Command.make("testflight").pipe(
  Command.withDescription(
    "Manage TestFlight beta distribution on App Store Connect (CI-safe, uses an ASC API key)",
  ),
  Command.withSubcommands([
    testflightGroupCommand,
    testflightTesterCommand,
    testflightReviewCommand,
    testflightBuildCommand,
    testflightFeedbackCommand,
  ]),
  Command.provide(applePortalExitCodes),
);

import { Command } from "effect/unstable/cli";

import { reviewSetDetailCommand } from "./set-detail";
import { reviewStatusCommand } from "./status";
import { reviewSubmitCommand } from "./submit";
import { reviewWithdrawCommand } from "./withdraw";

export const testflightReviewCommand = Command.make("review").pipe(
  Command.withDescription(
    "Manage external TestFlight beta review (submit, status, withdraw, set-detail)",
  ),
  Command.withSubcommands([
    reviewSubmitCommand,
    reviewStatusCommand,
    reviewWithdrawCommand,
    reviewSetDetailCommand,
  ]),
);

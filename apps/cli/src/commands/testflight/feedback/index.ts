import { Command } from "effect/unstable/cli";

import { feedbackListCommand } from "./list";

export const testflightFeedbackCommand = Command.make("feedback").pipe(
  Command.withDescription("Read TestFlight tester feedback (screenshot + crash submissions)"),
  Command.withSubcommands([feedbackListCommand]),
);

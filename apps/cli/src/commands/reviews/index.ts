import { Command } from "effect/unstable/cli";

import { applePortalExitCodes } from "../../lib/command-errors";
import { reviewsListCommand } from "./list";
import { reviewsReplyCommand } from "./reply";

export const reviewsCommand = Command.make("reviews").pipe(
  Command.withDescription(
    "Read and respond to App Store customer reviews (CI-safe, uses an ASC API key)",
  ),
  Command.withSubcommands([reviewsListCommand, reviewsReplyCommand]),
  Command.provide(applePortalExitCodes),
);

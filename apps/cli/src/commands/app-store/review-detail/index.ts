import { Command } from "effect/unstable/cli";

import { reviewDetailSetCommand } from "./set";

export const appStoreReviewDetailCommand = Command.make("review-detail").pipe(
  Command.withDescription(
    "Manage the App Review detail (contact + demo account) on the editable version",
  ),
  Command.withSubcommands([reviewDetailSetCommand]),
);

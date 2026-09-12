import { Command } from "effect/unstable/cli";

import { applePortalExitCodes } from "../../lib/command-errors";
import { appReviewListCommand } from "./list";
import { appReviewRejectionsCommand } from "./rejections";
import { appReviewReplyCommand } from "./reply";
import { appReviewViewCommand } from "./view";

export const appReviewCommand = Command.make("app-review").pipe(
  Command.withDescription(
    "Communicate with Apple App Review via the Resolution Center (Apple ID login required; not CI-safe)",
  ),
  Command.withSubcommands([
    appReviewListCommand,
    appReviewViewCommand,
    appReviewRejectionsCommand,
    appReviewReplyCommand,
  ]),
  Command.provide(applePortalExitCodes),
);

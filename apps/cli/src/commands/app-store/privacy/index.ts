import { Command } from "effect/unstable/cli";

import { privacyClearCommand } from "./clear";
import { privacyGetCommand } from "./get";
import { privacyPublishCommand } from "./publish";
import { privacySetCommand } from "./set";

export const appStorePrivacyCommand = Command.make("privacy").pipe(
  Command.withDescription("Manage the App Privacy nutrition label (get, set, publish, clear)"),
  Command.withSubcommands([
    privacyGetCommand,
    privacySetCommand,
    privacyPublishCommand,
    privacyClearCommand,
  ]),
);

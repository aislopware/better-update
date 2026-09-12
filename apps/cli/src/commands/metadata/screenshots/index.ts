import { Command } from "effect/unstable/cli";

import { screenshotsClearCommand } from "./clear";
import { screenshotsUploadCommand } from "./upload";

export const metadataScreenshotsCommand = Command.make("screenshots").pipe(
  Command.withDescription("Upload and clear App Store screenshots on the editable version"),
  Command.withSubcommands([screenshotsUploadCommand, screenshotsClearCommand]),
);

import { Command } from "effect/unstable/cli";

import { applePortalExitCodes } from "../../lib/command-errors";
import { metadataMediaCommand } from "./media";
import { metadataPreviewsCommand } from "./previews";
import { metadataScreenshotsCommand } from "./screenshots";

export const metadataCommand = Command.make("metadata").pipe(
  Command.withDescription(
    "Manage App Store store media — screenshots and preview videos (CI-safe, uses an ASC API key)",
  ),
  Command.withSubcommands([
    metadataMediaCommand,
    metadataScreenshotsCommand,
    metadataPreviewsCommand,
  ]),
  Command.provide(applePortalExitCodes),
);

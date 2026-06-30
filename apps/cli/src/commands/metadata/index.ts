import { defineCommand } from "citty";

import { metadataMediaCommand } from "./media";
import { metadataPreviewsCommand } from "./previews";
import { metadataScreenshotsCommand } from "./screenshots";

export const metadataCommand = defineCommand({
  meta: {
    name: "metadata",
    description:
      "Manage App Store store media — screenshots and preview videos (CI-safe, uses an ASC API key)",
  },
  subCommands: {
    media: metadataMediaCommand,
    screenshots: metadataScreenshotsCommand,
    previews: metadataPreviewsCommand,
  },
});

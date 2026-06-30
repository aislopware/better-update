import { defineCommand } from "citty";

import { screenshotsClearCommand } from "./clear";
import { screenshotsUploadCommand } from "./upload";

export const metadataScreenshotsCommand = defineCommand({
  meta: {
    name: "screenshots",
    description: "Upload and clear App Store screenshots on the editable version",
  },
  subCommands: {
    upload: screenshotsUploadCommand,
    clear: screenshotsClearCommand,
  },
});

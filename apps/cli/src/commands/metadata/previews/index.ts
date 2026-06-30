import { defineCommand } from "citty";

import { previewsUploadCommand } from "./upload";

export const metadataPreviewsCommand = defineCommand({
  meta: {
    name: "previews",
    description: "Upload App Store preview videos on the editable version",
  },
  subCommands: {
    upload: previewsUploadCommand,
  },
});

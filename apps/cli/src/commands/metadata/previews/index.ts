import { Command } from "effect/unstable/cli";

import { previewsUploadCommand } from "./upload";

export const metadataPreviewsCommand = Command.make("previews").pipe(
  Command.withDescription("Upload App Store preview videos on the editable version"),
  Command.withSubcommands([previewsUploadCommand]),
);

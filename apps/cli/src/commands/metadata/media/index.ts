import { defineCommand } from "citty";

import { mediaListCommand } from "./list";
import { mediaSyncCommand } from "./sync";

export const metadataMediaCommand = defineCommand({
  meta: {
    name: "media",
    description: "Inspect and declaratively sync App Store screenshots + previews",
  },
  subCommands: {
    list: mediaListCommand,
    sync: mediaSyncCommand,
  },
});

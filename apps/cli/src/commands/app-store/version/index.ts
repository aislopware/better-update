import { defineCommand } from "citty";

import { versionCreateCommand } from "./create";
import { versionListCommand } from "./list";
import { versionLocalizeCommand } from "./localize";
import { versionSetCommand } from "./set";

export const appStoreVersionCommand = defineCommand({
  meta: {
    name: "version",
    description:
      "Manage the editable App Store version (list, create, set build/metadata, localize)",
  },
  subCommands: {
    list: versionListCommand,
    create: versionCreateCommand,
    set: versionSetCommand,
    localize: versionLocalizeCommand,
  },
});

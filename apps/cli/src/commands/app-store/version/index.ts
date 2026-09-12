import { Command } from "effect/unstable/cli";

import { versionCreateCommand } from "./create";
import { versionListCommand } from "./list";
import { versionLocalizeCommand } from "./localize";
import { versionSetCommand } from "./set";

export const appStoreVersionCommand = Command.make("version").pipe(
  Command.withDescription(
    "Manage the editable App Store version (list, create, set build/metadata, localize)",
  ),
  Command.withSubcommands([
    versionListCommand,
    versionCreateCommand,
    versionSetCommand,
    versionLocalizeCommand,
  ]),
);

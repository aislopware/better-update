import { Command } from "effect/unstable/cli";

import { mediaListCommand } from "./list";
import { mediaSyncCommand } from "./sync";

export const metadataMediaCommand = Command.make("media").pipe(
  Command.withDescription("Inspect and declaratively sync App Store screenshots + previews"),
  Command.withSubcommands([mediaListCommand, mediaSyncCommand]),
);

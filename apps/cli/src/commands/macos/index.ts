import { Command } from "effect/unstable/cli";

import { notarizeCommand } from "./notarize";
import { signCommand } from "./sign";

export const macosCommand = Command.make("macos").pipe(
  Command.withDescription(
    "Sign and notarize macOS apps with vault-stored Developer ID credentials (Developer ID Application .p12 + ASC API key)",
  ),
  Command.withSubcommands([signCommand, notarizeCommand]),
);

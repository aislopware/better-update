import { Command } from "effect/cli";

import { notarizeCommand } from "./notarize";
import { packageCommand } from "./package";
import { releaseCommand } from "./release";
import { signCommand } from "./sign";

export const macosCommand = Command.make("macos").pipe(
  Command.withDescription(
    "Sign, package (DMG/zip/pkg), notarize and release macOS apps with vault-stored Developer ID credentials (Developer ID .p12 + ASC API key)",
  ),
  Command.withSubcommands([signCommand, packageCommand, notarizeCommand, releaseCommand]),
);

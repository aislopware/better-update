import { defineCommand } from "citty";

import { notarizeCommand } from "./notarize";
import { signCommand } from "./sign";

export const macosCommand = defineCommand({
  meta: {
    name: "macos",
    description:
      "Sign and notarize macOS apps with vault-stored Developer ID credentials (Developer ID Application .p12 + ASC API key)",
  },
  subCommands: {
    sign: signCommand,
    notarize: notarizeCommand,
  },
});

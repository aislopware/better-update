import { defineCommand } from "citty";

import { appStoreReleaseCommand } from "./release";
import { appStoreRolloutCommand } from "./rollout";
import { appStoreStatusCommand } from "./status";
import { appStoreSubmitCommand } from "./submit";
import { appStoreVersionCommand } from "./version";

export const appStoreCommand = defineCommand({
  meta: {
    name: "app-store",
    description:
      "Drive the App Store release pipeline on App Store Connect (CI-safe, uses an ASC API key)",
  },
  subCommands: {
    version: appStoreVersionCommand,
    submit: appStoreSubmitCommand,
    status: appStoreStatusCommand,
    release: appStoreReleaseCommand,
    rollout: appStoreRolloutCommand,
  },
});

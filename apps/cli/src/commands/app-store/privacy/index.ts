import { defineCommand } from "citty";

import { privacyClearCommand } from "./clear";
import { privacyGetCommand } from "./get";
import { privacyPublishCommand } from "./publish";
import { privacySetCommand } from "./set";

export const appStorePrivacyCommand = defineCommand({
  meta: {
    name: "privacy",
    description: "Manage the App Privacy nutrition label (get, set, publish, clear)",
  },
  subCommands: {
    get: privacyGetCommand,
    set: privacySetCommand,
    publish: privacyPublishCommand,
    clear: privacyClearCommand,
  },
});

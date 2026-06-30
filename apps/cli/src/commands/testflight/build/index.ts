import { defineCommand } from "citty";

import { buildWhatsNewCommand } from "./whats-new";

export const testflightBuildCommand = defineCommand({
  meta: {
    name: "build",
    description: "Manage TestFlight build metadata (what's-new / 'What to Test')",
  },
  subCommands: {
    "whats-new": buildWhatsNewCommand,
  },
});

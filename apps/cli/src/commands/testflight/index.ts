import { defineCommand } from "citty";

import { testflightGroupCommand } from "./group";

export const testflightCommand = defineCommand({
  meta: {
    name: "testflight",
    description:
      "Manage TestFlight beta distribution on App Store Connect (CI-safe, uses an ASC API key)",
  },
  subCommands: {
    group: testflightGroupCommand,
  },
});

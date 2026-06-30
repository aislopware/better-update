import { defineCommand } from "citty";

import { testflightBuildCommand } from "./build";
import { testflightGroupCommand } from "./group";
import { testflightReviewCommand } from "./review";
import { testflightTesterCommand } from "./tester";

export const testflightCommand = defineCommand({
  meta: {
    name: "testflight",
    description:
      "Manage TestFlight beta distribution on App Store Connect (CI-safe, uses an ASC API key)",
  },
  subCommands: {
    group: testflightGroupCommand,
    tester: testflightTesterCommand,
    review: testflightReviewCommand,
    build: testflightBuildCommand,
  },
});

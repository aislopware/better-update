import { defineCommand } from "citty";

import { feedbackListCommand } from "./list";

export const testflightFeedbackCommand = defineCommand({
  meta: {
    name: "feedback",
    description: "Read TestFlight tester feedback (screenshot + crash submissions)",
  },
  subCommands: {
    list: feedbackListCommand,
  },
});

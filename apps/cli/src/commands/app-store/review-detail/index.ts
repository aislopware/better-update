import { defineCommand } from "citty";

import { reviewDetailSetCommand } from "./set";

export const appStoreReviewDetailCommand = defineCommand({
  meta: {
    name: "review-detail",
    description: "Manage the App Review detail (contact + demo account) on the editable version",
  },
  subCommands: {
    set: reviewDetailSetCommand,
  },
});

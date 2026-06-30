import { defineCommand } from "citty";

import { appReviewListCommand } from "./list";
import { appReviewRejectionsCommand } from "./rejections";
import { appReviewReplyCommand } from "./reply";
import { appReviewViewCommand } from "./view";

export const appReviewCommand = defineCommand({
  meta: {
    name: "app-review",
    description:
      "Communicate with Apple App Review via the Resolution Center (Apple ID login required; not CI-safe)",
  },
  subCommands: {
    list: appReviewListCommand,
    view: appReviewViewCommand,
    rejections: appReviewRejectionsCommand,
    reply: appReviewReplyCommand,
  },
});

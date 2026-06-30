import { defineCommand } from "citty";

import { reviewsListCommand } from "./list";
import { reviewsReplyCommand } from "./reply";

export const reviewsCommand = defineCommand({
  meta: {
    name: "reviews",
    description: "Read and respond to App Store customer reviews (CI-safe, uses an ASC API key)",
  },
  subCommands: {
    list: reviewsListCommand,
    reply: reviewsReplyCommand,
  },
});

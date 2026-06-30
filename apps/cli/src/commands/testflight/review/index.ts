import { defineCommand } from "citty";

import { reviewSetDetailCommand } from "./set-detail";
import { reviewStatusCommand } from "./status";
import { reviewSubmitCommand } from "./submit";
import { reviewWithdrawCommand } from "./withdraw";

export const testflightReviewCommand = defineCommand({
  meta: {
    name: "review",
    description: "Manage external TestFlight beta review (submit, status, withdraw, set-detail)",
  },
  subCommands: {
    submit: reviewSubmitCommand,
    status: reviewStatusCommand,
    withdraw: reviewWithdrawCommand,
    "set-detail": reviewSetDetailCommand,
  },
});

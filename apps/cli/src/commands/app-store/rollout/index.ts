import { defineCommand } from "citty";

import { rolloutCompleteCommand } from "./complete";
import { rolloutPauseCommand } from "./pause";
import { rolloutResumeCommand } from "./resume";
import { rolloutStartCommand } from "./start";
import { rolloutStatusCommand } from "./status";

export const appStoreRolloutCommand = defineCommand({
  meta: {
    name: "rollout",
    description: "Manage a phased (staged) release: start, status, pause, resume, complete",
  },
  subCommands: {
    start: rolloutStartCommand,
    status: rolloutStatusCommand,
    pause: rolloutPauseCommand,
    resume: rolloutResumeCommand,
    complete: rolloutCompleteCommand,
  },
});

import { defineCommand } from "citty";

import { adoptionCommand } from "./adoption";
import { channelsCommand } from "./channels";
import { platformsCommand } from "./platforms";
import { updatesCommand } from "./updates";

export const analyticsCommand = defineCommand({
  meta: { name: "analytics", description: "View deployment analytics" },
  subCommands: {
    adoption: adoptionCommand,
    updates: updatesCommand,
    channels: channelsCommand,
    platforms: platformsCommand,
  },
});

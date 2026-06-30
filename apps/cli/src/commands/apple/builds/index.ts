import { defineCommand } from "citty";

import { buildsComplianceCommand } from "./compliance";
import { buildsGetCommand } from "./get";
import { buildsListCommand } from "./list";
import { buildsStatusCommand } from "./status";

export const appleBuildsCommand = defineCommand({
  meta: {
    name: "builds",
    description: "Inspect App Store Connect builds and answer export compliance (CI-safe)",
  },
  subCommands: {
    list: buildsListCommand,
    get: buildsGetCommand,
    status: buildsStatusCommand,
    compliance: buildsComplianceCommand,
  },
});

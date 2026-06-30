import { defineCommand } from "citty";

import { territoriesListCommand } from "./list";

export const appStoreTerritoriesCommand = defineCommand({
  meta: {
    name: "territories",
    description: "List App Store territories (reference ids for availability)",
  },
  subCommands: {
    list: territoriesListCommand,
  },
});

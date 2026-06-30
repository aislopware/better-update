import { defineCommand } from "citty";

import { ascKeyListCommand } from "./list";

export const appleAscKeyCommand = defineCommand({
  meta: {
    name: "asc-key",
    description:
      "Inspect upstream App Store Connect API keys on Apple (Apple ID login). Create via `credentials generate asc-key`, revoke via `credentials revoke asc-key`.",
  },
  subCommands: {
    list: ascKeyListCommand,
  },
});

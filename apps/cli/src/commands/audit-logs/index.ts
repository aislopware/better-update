import { defineCommand } from "citty";

import { listCommand } from "./list";

export const auditLogsCommand = defineCommand({
  meta: { name: "audit-logs", description: "View audit logs" },
  subCommands: {
    list: listCommand,
  },
});

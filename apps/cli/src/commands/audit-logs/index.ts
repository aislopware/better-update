import { Command } from "effect/cli";

import { listCommand } from "./list";

export const auditLogsCommand = Command.make("audit-logs").pipe(
  Command.withDescription("View audit logs"),
  Command.withSubcommands([listCommand]),
);

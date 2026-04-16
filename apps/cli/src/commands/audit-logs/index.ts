import { Command } from "@effect/cli";
import { Console } from "effect";

import { listCommand } from "./list";

export const auditLogsCommand = Command.make("audit-logs", {}, () =>
  Console.log("View audit logs. Run with --help for subcommands."),
).pipe(Command.withSubcommands([listCommand]));

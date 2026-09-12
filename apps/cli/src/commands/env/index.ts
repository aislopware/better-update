import { Command } from "effect/unstable/cli";

import { deleteCommand } from "./delete";
import { execCommand } from "./exec";
import { exportCommand } from "./export";
import { getCommand } from "./get";
import { historyCommand } from "./history";
import { importCommand } from "./import";
import { listCommand } from "./list";
import { pullCommand } from "./pull";
import { pushCommand } from "./push";
import { rollbackCommand } from "./rollback";
import { setCommand } from "./set";
import { updateCommand } from "./update";

export const envCommand = Command.make("env").pipe(
  Command.withDescription("Manage environment variables"),
  Command.withSubcommands([
    listCommand,
    getCommand,
    setCommand,
    updateCommand,
    deleteCommand,
    historyCommand,
    rollbackCommand,
    importCommand,
    pushCommand,
    exportCommand,
    pullCommand,
    execCommand,
  ]),
);

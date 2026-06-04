import { defineCommand } from "citty";

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

export const envCommand = defineCommand({
  meta: { name: "env", description: "Manage environment variables" },
  subCommands: {
    list: listCommand,
    get: getCommand,
    set: setCommand,
    update: updateCommand,
    delete: deleteCommand,
    history: historyCommand,
    rollback: rollbackCommand,
    import: importCommand,
    push: pushCommand,
    export: exportCommand,
    pull: pullCommand,
    exec: execCommand,
  },
});

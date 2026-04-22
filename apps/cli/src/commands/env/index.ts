import { defineCommand } from "citty";

import { deleteCommand } from "./delete";
import { exportCommand } from "./export";
import { getCommand } from "./get";
import { importCommand } from "./import";
import { listCommand } from "./list";
import { pullCommand } from "./pull";
import { setCommand } from "./set";

export const envCommand = defineCommand({
  meta: { name: "env", description: "Manage environment variables" },
  subCommands: {
    list: listCommand,
    get: getCommand,
    set: setCommand,
    delete: deleteCommand,
    import: importCommand,
    export: exportCommand,
    pull: pullCommand,
  },
});

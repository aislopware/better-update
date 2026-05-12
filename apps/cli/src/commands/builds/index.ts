import { defineCommand } from "citty";

import { compatibilityMatrixCommand } from "./compatibility-matrix";
import { deleteCommand } from "./delete";
import { getCommand } from "./get";
import { installLinkCommand } from "./install-link";
import { listCommand } from "./list";
import { resignCommand } from "./resign";
import { uploadCommand } from "./upload";

export const buildsCommand = defineCommand({
  meta: { name: "builds", description: "Manage builds" },
  subCommands: {
    list: listCommand,
    get: getCommand,
    delete: deleteCommand,
    "install-link": installLinkCommand,
    "compatibility-matrix": compatibilityMatrixCommand,
    upload: uploadCommand,
    resign: resignCommand,
  },
});

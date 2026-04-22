import { defineCommand } from "citty";

import { deleteCommand } from "./delete";
import { listCommand } from "./list";
import { uploadCommand } from "./upload";

export const credentialsCommand = defineCommand({
  meta: { name: "credentials", description: "Manage credentials" },
  subCommands: {
    list: listCommand,
    upload: uploadCommand,
    delete: deleteCommand,
  },
});

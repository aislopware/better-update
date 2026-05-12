import { defineCommand } from "citty";

import { configureCommand } from "./configure";
import { deleteCommand } from "./delete";
import { downloadCommand } from "./download";
import { generateCommand } from "./generate";
import { listCommand } from "./list";
import { removeCommand } from "./remove";
import { syncCommand } from "./sync";
import { uploadCommand } from "./upload";
import { uploadAscKeyCommand } from "./upload-asc-key";
import { viewCommand } from "./view";

export const credentialsCommand = defineCommand({
  meta: { name: "credentials", description: "Manage credentials" },
  subCommands: {
    list: listCommand,
    view: viewCommand,
    download: downloadCommand,
    upload: uploadCommand,
    "upload-asc-key": uploadAscKeyCommand,
    generate: generateCommand,
    delete: deleteCommand,
    remove: removeCommand,
    configure: configureCommand,
    sync: syncCommand,
  },
});

import { defineCommand } from "citty";

import { runCredentialsManager } from "../../application/credentials-manager";
import { runEffect } from "../../lib/citty-effect";
import { configureCommand } from "./configure";
import { deleteCommand } from "./delete";
import { downloadCommand } from "./download";
import { generateCommand } from "./generate";
import { listCommand } from "./list";
import { regenerateProfileCommand } from "./regenerate-profile";
import { removeCommand } from "./remove";
import { revokeCommand } from "./revoke";
import { syncCommand } from "./sync";
import { uploadCommand } from "./upload";
import { uploadAscKeyCommand } from "./upload-asc-key";
import { viewCommand } from "./view";

const managerCommand = defineCommand({
  meta: {
    name: "manager",
    description: "Interactive credentials manager (top-level wizard: platform → category → action)",
  },
  run: async () => runEffect(runCredentialsManager),
});

export const credentialsCommand = defineCommand({
  meta: { name: "credentials", description: "Manage credentials" },
  subCommands: {
    manager: managerCommand,
    list: listCommand,
    view: viewCommand,
    download: downloadCommand,
    upload: uploadCommand,
    "upload-asc-key": uploadAscKeyCommand,
    generate: generateCommand,
    "regenerate-profile": regenerateProfileCommand,
    delete: deleteCommand,
    remove: removeCommand,
    revoke: revokeCommand,
    configure: configureCommand,
    sync: syncCommand,
  },
  run: async () => runEffect(runCredentialsManager),
});

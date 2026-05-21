import { defineCommand } from "citty";

import { runCredentialsManager } from "../../application/credentials-manager";
import { runEffect } from "../../lib/citty-effect";
import { accessCommand } from "./access";
import { configureCommand } from "./configure";
import { deleteCommand } from "./delete";
import { deviceCommand } from "./device";
import { downloadCommand } from "./download";
import { generateCommand } from "./generate";
import { identityCommand } from "./identity";
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

// citty 0.2.2 invokes the parent `run` even when a subcommand was specified, so
// keeping `run: runCredentialsManager` here triggers the interactive wizard
// after every `cli credentials <sub>` call and blocks on stdin forever. Route the
// no-arg invocation through `default: "manager"` instead — that runs the manager
// subcommand only when no other subcommand was given.
export const credentialsCommand = defineCommand({
  meta: { name: "credentials", description: "Manage credentials" },
  subCommands: {
    manager: managerCommand,
    identity: identityCommand,
    access: accessCommand,
    device: deviceCommand,
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
  default: "manager",
});

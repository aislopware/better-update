import { Command } from "effect/unstable/cli";

import { runCredentialsManager } from "../../application/credentials-manager";
import { runCommand } from "../../lib/run-command";
import { accessCommand } from "./access";
import { accountCommand } from "./account";
import { bindingsCommand } from "./bindings";
import { bundleIdCommand } from "./bundle-id";
import { capabilityCommand } from "./capability";
import { certificateCommand } from "./certificate";
import { configureCommand } from "./configure";
import { deleteCommand } from "./delete";
import { deviceCommand } from "./device";
import { downloadCommand } from "./download";
import { envVaultCommand } from "./env-vault";
import { generateCommand } from "./generate";
import { identityCommand } from "./identity";
import { listCommand } from "./list";
import { passphraseCommand } from "./passphrase";
import { profileCommand } from "./profile";
import { regenerateProfileCommand } from "./regenerate-profile";
import { removeCommand } from "./remove";
import { revokeCommand } from "./revoke";
import { robotCommand } from "./robot";
import { lockCommand, statusCommand, unlockCommand } from "./session";
import { syncCommand } from "./sync";
import { uploadCommand } from "./upload";
import { uploadAscKeyCommand } from "./upload-asc-key";
import { viewCommand } from "./view";

const managerHandler = () => runCredentialsManager.pipe(runCommand());

const managerCommand = Command.make("manager", {}, managerHandler).pipe(
  Command.withDescription(
    "Interactive credentials manager (top-level wizard: platform → category → action)",
  ),
);

// The parent handler runs ONLY when no subcommand was given (bare
// `credentials`), so it can open the interactive manager without racing the
// subcommands.
export const credentialsCommand = Command.make("credentials", {}, managerHandler).pipe(
  Command.withDescription("Manage credentials"),
  Command.withSubcommands([
    managerCommand,
    identityCommand,
    robotCommand,
    bindingsCommand,
    accessCommand,
    accountCommand,
    envVaultCommand,
    passphraseCommand,
    deviceCommand,
    unlockCommand,
    lockCommand,
    statusCommand,
    listCommand,
    viewCommand,
    downloadCommand,
    uploadCommand,
    uploadAscKeyCommand,
    generateCommand,
    regenerateProfileCommand,
    deleteCommand,
    removeCommand,
    revokeCommand,
    configureCommand,
    syncCommand,
    certificateCommand,
    bundleIdCommand,
    profileCommand,
    capabilityCommand,
  ]),
);

import { Command } from "effect/unstable/cli";

import { compatibilityMatrixCommand } from "./compatibility-matrix";
import { deleteCommand } from "./delete";
import { downloadCommand } from "./download";
import { downloadSymbolsCommand } from "./download-symbols";
import { getCommand } from "./get";
import { installLinkCommand } from "./install-link";
import { listCommand } from "./list";
import { resignCommand } from "./resign";
import { runBuildCommand } from "./run";
import { uploadCommand } from "./upload";

export const buildsCommand = Command.make("builds").pipe(
  Command.withDescription("Manage builds"),
  Command.withSubcommands([
    listCommand,
    getCommand,
    deleteCommand,
    downloadCommand,
    downloadSymbolsCommand,
    runBuildCommand,
    installLinkCommand,
    compatibilityMatrixCommand,
    uploadCommand,
    resignCommand,
  ]),
);

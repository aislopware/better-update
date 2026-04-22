import { Command } from "@effect/cli";
import { Console } from "effect";

import { compatibilityMatrixCommand } from "./compatibility-matrix";
import { deleteCommand } from "./delete";
import { getCommand } from "./get";
import { installLinkCommand } from "./install-link";
import { listCommand } from "./list";
import { uploadCommand } from "./upload";

export const buildsCommand = Command.make("builds", {}, () =>
  Console.log("Manage builds. Run with --help for subcommands."),
).pipe(
  Command.withSubcommands([
    listCommand,
    getCommand,
    deleteCommand,
    installLinkCommand,
    compatibilityMatrixCommand,
    uploadCommand,
  ]),
);

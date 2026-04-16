import { Command } from "@effect/cli";
import { Console } from "effect";

import { activateCommand } from "./activate";
import { deleteCommand } from "./delete";
import { downloadCommand } from "./download";
import { generateIosCredentialsCommand } from "./generate-ios-credentials";
import { generateKeystoreCommand } from "./generate-keystore";
import { getCommand } from "./get";
import { listCommand } from "./list";
import { uploadCommand } from "./upload";

export const credentialsCommand = Command.make("credentials", {}, () =>
  Console.log("Manage credentials. Run with --help for subcommands."),
).pipe(
  Command.withSubcommands([
    listCommand,
    getCommand,
    uploadCommand,
    downloadCommand,
    generateKeystoreCommand,
    generateIosCredentialsCommand,
    activateCommand,
    deleteCommand,
  ]),
);

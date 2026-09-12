import { Command } from "effect/unstable/cli";

import { configureCommand } from "./configure";
import { deleteCommand } from "./delete";
import { editCommand } from "./edit";
import { embeddedDeleteCommand, embeddedListCommand, embeddedViewCommand } from "./embedded";
import { embeddedUploadCommand } from "./embedded-upload";
import { insightsCommand } from "./insights";
import { listCommand } from "./list";
import { promoteCommand } from "./promote";
import { publishCommand } from "./publish";
import { republishCommand } from "./republish";
import { revertCommand } from "./revert";
import { revertRolloutCommand } from "./revert-rollout";
import { rollbackCommand, rollBackToEmbeddedCommand } from "./rollback";
import { rolloutCommand } from "./rollout";
import { sourcemapCommand } from "./sourcemap";
import { viewCommand } from "./view";

export const updateCommand = Command.make("update").pipe(
  Command.withDescription("Manage OTA updates"),
  Command.withSubcommands([
    publishCommand,
    configureCommand,
    listCommand,
    viewCommand,
    deleteCommand,
    editCommand,
    embeddedUploadCommand,
    embeddedListCommand,
    embeddedViewCommand,
    embeddedDeleteCommand,
    promoteCommand,
    republishCommand,
    rollbackCommand,
    rollBackToEmbeddedCommand,
    revertCommand,
    rolloutCommand,
    revertRolloutCommand,
    insightsCommand,
    sourcemapCommand,
  ]),
);

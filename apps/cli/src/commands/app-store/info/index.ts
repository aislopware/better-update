import { Command } from "effect/unstable/cli";

import { infoLocalizeCommand } from "./localize";
import { infoSetCategoriesCommand } from "./set-categories";
import { infoShowCommand } from "./show";

export const appStoreInfoCommand = Command.make("info").pipe(
  Command.withDescription(
    "Manage App Store listing metadata (store name, subtitle, privacy URL, categories)",
  ),
  Command.withSubcommands([infoShowCommand, infoLocalizeCommand, infoSetCategoriesCommand]),
);

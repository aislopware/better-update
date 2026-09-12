import { Command } from "effect/unstable/cli";

import { categoriesListCommand } from "./list";

export const appStoreCategoriesCommand = Command.make("categories").pipe(
  Command.withDescription(
    "List the valid App Store category ids (reference for `info set-categories`)",
  ),
  Command.withSubcommands([categoriesListCommand]),
);

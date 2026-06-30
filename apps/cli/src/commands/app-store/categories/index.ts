import { defineCommand } from "citty";

import { categoriesListCommand } from "./list";

export const appStoreCategoriesCommand = defineCommand({
  meta: {
    name: "categories",
    description: "List the valid App Store category ids (reference for `info set-categories`)",
  },
  subCommands: {
    list: categoriesListCommand,
  },
});

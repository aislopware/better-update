import { defineCommand } from "citty";

import { infoLocalizeCommand } from "./localize";
import { infoSetCategoriesCommand } from "./set-categories";
import { infoShowCommand } from "./show";

export const appStoreInfoCommand = defineCommand({
  meta: {
    name: "info",
    description:
      "Manage App Store listing metadata (store name, subtitle, privacy URL, categories)",
  },
  subCommands: {
    show: infoShowCommand,
    localize: infoLocalizeCommand,
    "set-categories": infoSetCategoriesCommand,
  },
});

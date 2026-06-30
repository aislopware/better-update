import { defineCommand } from "citty";
import { Effect } from "effect";

import { listApps } from "../../../application/app-store-apps";
import {
  APP_STORE_EXIT_EXTRAS,
  ASC_AUTH_ARGS,
  openAscContext,
} from "../../../application/app-store-connect";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanList } from "../../../lib/output";

import type { AscAuthArgs } from "../../../application/app-store-connect";

export const appsListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List every app the App Store Connect API key can see (CI-safe)",
  },
  args: {
    ...ASC_AUTH_ARGS,
  },
  run: async ({ args }: { readonly args: AscAuthArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const session = yield* openAscContext(args);
        const apps = yield* listApps(session.ctx);
        yield* printHumanList(
          ["Name", "Bundle id", "SKU", "Locale", "ID"],
          apps.map((app) => [app.name, app.bundleId, app.sku, app.primaryLocale, app.id]),
          "No apps found.",
        );
        return { items: apps };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

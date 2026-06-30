import { defineCommand } from "citty";
import { Effect } from "effect";

import { listAllTerritories } from "../../../application/app-store-commerce";
import {
  APP_STORE_EXIT_EXTRAS,
  ASC_AUTH_ARGS,
  openAscContext,
} from "../../../application/app-store-connect";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanList } from "../../../lib/output";

import type { AscAuthArgs } from "../../../application/app-store-connect";

export const territoriesListCommand = defineCommand({
  meta: {
    name: "list",
    description:
      "List every App Store territory id + currency (the ids `availability set` takes) (CI-safe)",
  },
  args: {
    ...ASC_AUTH_ARGS,
  },
  run: async ({ args }: { readonly args: AscAuthArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const session = yield* openAscContext(args);
        const territories = yield* listAllTerritories(session.ctx);
        yield* printHumanList(
          ["Territory", "Currency"],
          territories.map((territory) => [territory.id, territory.currency]),
          "No territories returned.",
        );
        return { count: territories.length, items: territories };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

import { defineCommand } from "citty";
import { Effect } from "effect";

import { showAvailability } from "../../../application/app-store-commerce";
import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { runEffect } from "../../../lib/citty-effect";
import { printHuman, printHumanList } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

export const availabilityShowCommand = defineCommand({
  meta: {
    name: "show",
    description: "Show the territories the app is available in (CI-safe)",
  },
  args: {
    ...ASC_COMMON_ARGS,
  },
  run: async ({ args }: { readonly args: AscCommonArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const session = yield* openAscSession(args);
        const territories = yield* showAvailability(session.ctx, session.appId);
        yield* printHuman(`Available in ${territories.length} territories.`);
        yield* printHumanList(
          ["Territory", "Currency"],
          territories.map((territory) => [territory.id, territory.currency]),
          "Not available in any territory.",
        );
        return { count: territories.length, items: territories };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

import { defineCommand } from "citty";
import { Effect } from "effect";

import { showPricing } from "../../../application/app-store-commerce";
import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { runEffect } from "../../../lib/citty-effect";
import { printHuman, printHumanList } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

export const pricingShowCommand = defineCommand({
  meta: {
    name: "show",
    description: "Show the app's current price schedule (CI-safe)",
  },
  args: {
    ...ASC_COMMON_ARGS,
  },
  run: async ({ args }: { readonly args: AscCommonArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const session = yield* openAscSession(args);
        const pricing = yield* showPricing(session.ctx, session.appId);
        if (!pricing.hasSchedule) {
          yield* printHuman("No price schedule set for this app.");
          return pricing;
        }
        yield* printHuman(
          `Base territory: ${pricing.baseTerritory ?? "—"} · automatic prices: ${pricing.automaticPriceCount}`,
        );
        yield* printHumanList(
          ["Territory", "Price point", "Start date"],
          pricing.manualPrices.map((price) => [
            price.territory ?? "—",
            price.pricePoint ?? "—",
            price.startDate ?? "immediate",
          ]),
          "No manual prices.",
        );
        return pricing;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

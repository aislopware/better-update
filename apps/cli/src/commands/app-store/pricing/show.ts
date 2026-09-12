import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { showPricing } from "../../../application/app-store-commerce";
import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { printHuman, printHumanList } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const pricingShowCommand = Command.make(
  "show",
  {
    ...ASC_COMMON_ARGS,
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Show the app's current price schedule (CI-safe)"));

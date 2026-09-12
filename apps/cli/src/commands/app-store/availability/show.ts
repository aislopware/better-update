import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { showAvailability } from "../../../application/app-store-commerce";
import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { printHuman, printHumanList } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const availabilityShowCommand = Command.make(
  "show",
  {
    ...ASC_COMMON_ARGS,
  },
  Effect.fn(
    function* (args) {
      const session = yield* openAscSession(args);
      const territories = yield* showAvailability(session.ctx, session.appId);
      yield* printHuman(`Available in ${territories.length} territories.`);
      yield* printHumanList(
        ["Territory", "Currency"],
        territories.map((territory) => [territory.id, territory.currency]),
        "Not available in any territory.",
      );
      return { count: territories.length, items: territories };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Show the territories the app is available in (CI-safe)"));

import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { listAllTerritories } from "../../../application/app-store-commerce";
import { ASC_AUTH_ARGS, openAscContext } from "../../../application/app-store-connect";
import { printHumanList } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const territoriesListCommand = Command.make(
  "list",
  {
    ...ASC_AUTH_ARGS,
  },
  Effect.fn(
    function* (args) {
      const session = yield* openAscContext(args);
      const territories = yield* listAllTerritories(session.ctx);
      yield* printHumanList(
        ["Territory", "Currency"],
        territories.map((territory) => [territory.id, territory.currency]),
        "No territories returned.",
      );
      return { count: territories.length, items: territories };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "List every App Store territory id + currency (the ids `availability set` takes) (CI-safe)",
  ),
);

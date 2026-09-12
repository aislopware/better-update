import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { setAvailability } from "../../../application/app-store-commerce";
import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { splitCommaList } from "../../../lib/asc-arg-parsers";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

/** Parse a comma-separated territory list flag, treating empty/whitespace as absent. */
const parseList = (raw: string | undefined): readonly string[] | undefined => {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  return splitCommaList(trimmed);
};

export const availabilitySetCommand = Command.make(
  "set",
  {
    ...ASC_COMMON_ARGS,
    territories: Flag.String("territories").pipe(
      Flag.withDescription("Comma-separated territory ids (USA,GBR,…) — REPLACES the whole set"),
      optionalFlag,
    ),
    add: Flag.String("add").pipe(
      Flag.withDescription("Comma-separated territory ids to add to the current set"),
      optionalFlag,
    ),
    remove: Flag.String("remove").pipe(
      Flag.withDescription("Comma-separated territory ids to remove"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const replace = parseList(args.territories);
      const add = parseList(args.add);
      const remove = parseList(args.remove);
      if (replace === undefined && add === undefined && remove === undefined) {
        return yield* new InvalidArgumentError({
          message:
            "Pass --territories <list> to replace the set, or --add/--remove <list> to adjust it (ids from `app-store territories list`).",
        });
      }
      if (replace !== undefined && (add !== undefined || remove !== undefined)) {
        return yield* new InvalidArgumentError({
          message: "--territories (full replace) cannot be combined with --add/--remove.",
        });
      }
      const session = yield* openAscSession(args);
      const result = yield* setAvailability(
        session.ctx,
        session.appId,
        compact({ replace, add, remove }),
      );
      yield* printHuman(`App is now available in ${result.count} territories.`);
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Set the app's territory availability (CI-safe). Use --territories to replace the set, or --add/--remove to adjust it.",
  ),
);

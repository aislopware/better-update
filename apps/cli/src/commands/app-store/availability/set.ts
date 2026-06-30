import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { setAvailability } from "../../../application/app-store-commerce";
import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { splitCommaList } from "../../../lib/asc-arg-parsers";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface AvailabilitySetArgs extends AscCommonArgs {
  readonly territories?: string | undefined;
  readonly add?: string | undefined;
  readonly remove?: string | undefined;
}

/** Parse a comma-separated territory list flag, treating empty/whitespace as absent. */
const parseList = (raw: string | undefined): readonly string[] | undefined => {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  return splitCommaList(trimmed);
};

export const availabilitySetCommand = defineCommand({
  meta: {
    name: "set",
    description:
      "Set the app's territory availability (CI-safe). Use --territories to replace the set, or --add/--remove to adjust it.",
  },
  args: {
    ...ASC_COMMON_ARGS,
    territories: {
      type: "string",
      description: "Comma-separated territory ids (USA,GBR,…) — REPLACES the whole set",
    },
    add: { type: "string", description: "Comma-separated territory ids to add to the current set" },
    remove: { type: "string", description: "Comma-separated territory ids to remove" },
  },
  run: async ({ args }: { readonly args: AvailabilitySetArgs }) =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

import { compact } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  coerceEnum,
  openAscSession,
} from "../../../application/app-store-connect";
import { setCategories } from "../../../application/app-store-info";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

const category = (raw: string | undefined, flag: string) =>
  raw === undefined
    ? Effect.succeed(undefined)
    : coerceEnum<AppleUtils.AppCategoryId>(AppleUtils.AppCategoryId, raw.toUpperCase(), flag);

const subcategory = (raw: string | undefined, flag: string) =>
  raw === undefined
    ? Effect.succeed(undefined)
    : coerceEnum<AppleUtils.AppSubcategoryId>(AppleUtils.AppSubcategoryId, raw.toUpperCase(), flag);

export const infoSetCategoriesCommand = Command.make(
  "set-categories",
  {
    ...ASC_COMMON_ARGS,
    primary: Flag.String("primary").pipe(
      Flag.withDescription("Primary category id, e.g. PRODUCTIVITY"),
      optionalFlag,
    ),
    "primary-subcategory-1": Flag.String("primary-subcategory-1").pipe(
      Flag.withDescription("Primary subcategory id (games/stickers)"),
      optionalFlag,
    ),
    "primary-subcategory-2": Flag.String("primary-subcategory-2").pipe(
      Flag.withDescription("Second primary subcategory id"),
      optionalFlag,
    ),
    secondary: Flag.String("secondary").pipe(
      Flag.withDescription("Secondary category id"),
      optionalFlag,
    ),
    "secondary-subcategory-1": Flag.String("secondary-subcategory-1").pipe(
      Flag.withDescription("Secondary subcategory id"),
      optionalFlag,
    ),
    "secondary-subcategory-2": Flag.String("secondary-subcategory-2").pipe(
      Flag.withDescription("Second secondary subcategory id"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const selection = compact({
        primaryCategory: yield* category(args.primary, "--primary"),
        primarySubcategoryOne: yield* subcategory(
          args["primary-subcategory-1"],
          "--primary-subcategory-1",
        ),
        primarySubcategoryTwo: yield* subcategory(
          args["primary-subcategory-2"],
          "--primary-subcategory-2",
        ),
        secondaryCategory: yield* category(args.secondary, "--secondary"),
        secondarySubcategoryOne: yield* subcategory(
          args["secondary-subcategory-1"],
          "--secondary-subcategory-1",
        ),
        secondarySubcategoryTwo: yield* subcategory(
          args["secondary-subcategory-2"],
          "--secondary-subcategory-2",
        ),
      });
      if (Object.keys(selection).length === 0) {
        return yield* new InvalidArgumentError({
          message: "Pass at least one of --primary, --secondary, or a subcategory flag.",
        });
      }
      const session = yield* openAscSession(args);
      const result = yield* setCategories(session.ctx, session.appId, selection);
      yield* printHuman("Updated App Store categories.");
      yield* printHumanKeyValue([
        ["Primary", result.primaryCategory ?? "—"],
        ["Secondary", result.secondaryCategory ?? "—"],
      ]);
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Set the App Store primary/secondary categories (ids from `app-store categories list`)",
  ),
);

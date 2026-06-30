import { compact } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  coerceEnum,
  openAscSession,
} from "../../../application/app-store-connect";
import { setCategories } from "../../../application/app-store-info";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface InfoSetCategoriesArgs extends AscCommonArgs {
  readonly primary?: string | undefined;
  readonly "primary-subcategory-1"?: string | undefined;
  readonly "primary-subcategory-2"?: string | undefined;
  readonly secondary?: string | undefined;
  readonly "secondary-subcategory-1"?: string | undefined;
  readonly "secondary-subcategory-2"?: string | undefined;
}

const category = (raw: string | undefined, flag: string) =>
  raw === undefined
    ? Effect.succeed(undefined)
    : coerceEnum<AppleUtils.AppCategoryId>(AppleUtils.AppCategoryId, raw.toUpperCase(), flag);

const subcategory = (raw: string | undefined, flag: string) =>
  raw === undefined
    ? Effect.succeed(undefined)
    : coerceEnum<AppleUtils.AppSubcategoryId>(AppleUtils.AppSubcategoryId, raw.toUpperCase(), flag);

export const infoSetCategoriesCommand = defineCommand({
  meta: {
    name: "set-categories",
    description:
      "Set the App Store primary/secondary categories (ids from `app-store categories list`)",
  },
  args: {
    ...ASC_COMMON_ARGS,
    primary: { type: "string", description: "Primary category id, e.g. PRODUCTIVITY" },
    "primary-subcategory-1": {
      type: "string",
      description: "Primary subcategory id (games/stickers)",
    },
    "primary-subcategory-2": { type: "string", description: "Second primary subcategory id" },
    secondary: { type: "string", description: "Secondary category id" },
    "secondary-subcategory-1": { type: "string", description: "Secondary subcategory id" },
    "secondary-subcategory-2": { type: "string", description: "Second secondary subcategory id" },
  },
  run: async ({ args }: { readonly args: InfoSetCategoriesArgs }) =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

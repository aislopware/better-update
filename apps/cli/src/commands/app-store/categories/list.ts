import AppleUtils from "@expo/apple-utils";
import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  coerceEnum,
  openAscSession,
} from "../../../application/app-store-connect";
import { listCategories } from "../../../application/app-store-info";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanList } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface CategoriesListArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
}

export const categoriesListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List valid App Store category ids for a platform",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "IOS",
      description: "Platform: IOS (default), MAC_OS, UNIVERSAL, SERVICES",
    },
  },
  run: async ({ args }: { readonly args: CategoriesListArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const platform = yield* coerceEnum<AppleUtils.BundleIdPlatform>(
          AppleUtils.BundleIdPlatform,
          (args.platform ?? "IOS").toUpperCase(),
          "--platform",
        );
        const session = yield* openAscSession(args);
        const categories = yield* listCategories(session.ctx, platform);
        yield* printHumanList(
          ["Category", "Platforms"],
          categories.map((category) => [category.id, category.platforms.join(", ")]),
          "No categories found.",
        );
        return { items: categories };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

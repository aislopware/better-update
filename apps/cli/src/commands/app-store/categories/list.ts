import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  coerceEnum,
  openAscSession,
} from "../../../application/app-store-connect";
import { listCategories } from "../../../application/app-store-info";
import { printHumanList } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const categoriesListCommand = Command.make(
  "list",
  {
    ...ASC_COMMON_ARGS,
    platform: Flag.String("platform").pipe(
      Flag.withDescription("Platform: IOS (default), MAC_OS, UNIVERSAL, SERVICES"),
      Flag.withDefault("IOS"),
    ),
  },
  Effect.fn(
    function* (args) {
      const platform = yield* coerceEnum<AppleUtils.BundleIdPlatform>(
        AppleUtils.BundleIdPlatform,
        args.platform.toUpperCase(),
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("List valid App Store category ids for a platform"));

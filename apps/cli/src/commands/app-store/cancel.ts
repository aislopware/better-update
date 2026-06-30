import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
  openAscSession,
} from "../../application/app-store-connect";
import { cancelReview } from "../../application/app-store-review";
import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";

import type { AscCommonArgs } from "../../application/app-store-connect";

interface CancelArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
}

export const appStoreCancelCommand = defineCommand({
  meta: {
    name: "cancel",
    description: "Cancel the app's in-progress App Review submission",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
  },
  run: async ({ args }: { readonly args: CancelArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const platform = yield* normalizePlatform(args.platform);
        const session = yield* openAscSession(args);
        const result = yield* cancelReview(session.ctx, session.appId, platform);
        yield* printHuman(`Cancelled review submission ${result.submissionId}.`);
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

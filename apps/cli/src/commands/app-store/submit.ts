import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
  openAscSession,
} from "../../application/app-store-connect";
import { submitForReview } from "../../application/app-store-review";
import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";

import type { AscCommonArgs } from "../../application/app-store-connect";

interface SubmitArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
}

export const appStoreSubmitCommand = defineCommand({
  meta: {
    name: "submit",
    description: "Submit the editable App Store version for App Review (idempotent)",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
  },
  run: async ({ args }: { readonly args: SubmitArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const platform = yield* normalizePlatform(args.platform);
        const session = yield* openAscSession(args);
        const result = yield* submitForReview(session.ctx, session.appId, platform);
        yield* printHuman(
          result.alreadyInProgress
            ? `A review submission is already in progress for ${result.versionString} (${result.state}).`
            : `Submitted ${result.versionString} for App Review (${result.state}).`,
        );
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

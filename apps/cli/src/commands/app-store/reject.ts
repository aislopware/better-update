import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
  openAscSession,
} from "../../application/app-store-connect";
import { rejectVersion } from "../../application/app-store-review";
import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";

import type { AscCommonArgs } from "../../application/app-store-connect";

interface RejectArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
}

export const appStoreRejectCommand = defineCommand({
  meta: {
    name: "reject",
    description: "Developer-reject the version in review, pulling it back from App Review",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
  },
  run: async ({ args }: { readonly args: RejectArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const platform = yield* normalizePlatform(args.platform);
        const session = yield* openAscSession(args);
        const result = yield* rejectVersion(session.ctx, session.appId, platform);
        yield* printHuman(`Developer-rejected version ${result.versionString}.`);
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

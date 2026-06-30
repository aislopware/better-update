import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
  openAscSession,
} from "../../application/app-store-connect";
import { releaseVersion } from "../../application/app-store-review";
import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";

import type { AscCommonArgs } from "../../application/app-store-connect";

interface ReleaseArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
}

export const appStoreReleaseCommand = defineCommand({
  meta: {
    name: "release",
    description: "Release an approved version that is pending manual developer release",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
  },
  run: async ({ args }: { readonly args: ReleaseArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const platform = yield* normalizePlatform(args.platform);
        const session = yield* openAscSession(args);
        const result = yield* releaseVersion(session.ctx, session.appId, platform);
        yield* printHuman(`Requested release of ${result.versionString} (${result.versionId}).`);
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

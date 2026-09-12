import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  openAscSession,
} from "../../application/app-store-connect";
import { releaseVersion } from "../../application/app-store-review";
import { printHuman } from "../../lib/output";
import { runCommand } from "../../lib/run-command";

export const appStoreReleaseCommand = Command.make(
  "release",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
  },
  Effect.fn(
    function* (args) {
      const platform = yield* normalizePlatform(args.platform);
      const session = yield* openAscSession(args);
      const result = yield* releaseVersion(session.ctx, session.appId, platform);
      yield* printHuman(`Requested release of ${result.versionString} (${result.versionId}).`);
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription("Release an approved version that is pending manual developer release"),
);

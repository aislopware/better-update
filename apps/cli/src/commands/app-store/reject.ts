import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  openAscSession,
} from "../../application/app-store-connect";
import { rejectVersion } from "../../application/app-store-review";
import { printHuman } from "../../lib/output";
import { runCommand } from "../../lib/run-command";

export const appStoreRejectCommand = Command.make(
  "reject",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
  },
  Effect.fn(
    function* (args) {
      const platform = yield* normalizePlatform(args.platform);
      const session = yield* openAscSession(args);
      const result = yield* rejectVersion(session.ctx, session.appId, platform);
      yield* printHuman(`Developer-rejected version ${result.versionString}.`);
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Developer-reject the version in review, pulling it back from App Review",
  ),
);

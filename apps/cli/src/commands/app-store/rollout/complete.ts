import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { completeRollout } from "../../../application/app-store-rollout";
import { printHuman } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";
import { renderRollout } from "./render";

export const rolloutCompleteCommand = Command.make(
  "complete",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
  },
  Effect.fn(
    function* (args) {
      const platform = yield* normalizePlatform(args.platform);
      const session = yield* openAscSession(args);
      const view = yield* completeRollout(session.ctx, session.appId, platform);
      yield* printHuman(`Phased release ${view.state} for ${view.versionString}.`);
      yield* renderRollout(view);
      return view;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Complete the phased release now (release to 100% of users)"));

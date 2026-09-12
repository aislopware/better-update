import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { rolloutStatus } from "../../../application/app-store-rollout";
import { printHuman } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";
import { renderRollout } from "./render";

export const rolloutStatusCommand = Command.make(
  "status",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
  },
  Effect.fn(
    function* (args) {
      const platform = yield* normalizePlatform(args.platform);
      const session = yield* openAscSession(args);
      const view = yield* rolloutStatus(session.ctx, session.appId, platform);
      if (view === null) {
        yield* printHuman("No phased release is configured for this version.");
        return { rollout: null };
      }
      yield* renderRollout(view);
      return { rollout: view };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Show the phased release progress for the rollout version"));

import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuild } from "../../../application/app-store-versions";
import { withdrawBetaReview } from "../../../application/testflight-review";
import { printHuman } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const reviewWithdrawCommand = Command.make(
  "withdraw",
  {
    ...ASC_COMMON_ARGS,
    ...BUILD_SELECTOR_ARGS,
  },
  Effect.fn(
    function* (args) {
      const session = yield* openAscSession(args);
      const build = yield* resolveBuild(session.ctx, session.appId, {
        buildId: args.build,
        buildVersion: args["build-version"],
      });
      const result = yield* withdrawBetaReview(build);
      yield* printHuman(`Withdrew beta review submission for build ${build.attributes.version}.`);
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Withdraw a build's in-flight external TestFlight beta review submission",
  ),
);

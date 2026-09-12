import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuild } from "../../../application/app-store-versions";
import { submitBetaReview } from "../../../application/testflight-review";
import { printHuman } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const reviewSubmitCommand = Command.make(
  "submit",
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
      const result = yield* submitBetaReview(build);
      yield* printHuman(
        result.alreadySubmitted
          ? `Build ${build.attributes.version} already submitted for beta review (${result.state}).`
          : `Submitted build ${build.attributes.version} for beta review (${result.state}).`,
      );
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Submit a build for external TestFlight beta review (idempotent)"));

import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuild } from "../../../application/app-store-versions";
import { betaReviewStatus } from "../../../application/testflight-review";
import { printHuman, printHumanKeyValue } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const reviewStatusCommand = Command.make(
  "status",
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
      const status = yield* betaReviewStatus(build);
      if (status === null) {
        yield* printHuman(`Build ${build.attributes.version} has no beta review submission.`);
        return { buildId: build.id, state: null };
      }
      yield* printHumanKeyValue([
        ["Build", build.attributes.version],
        ["State", status.state],
        ["Submitted", status.submittedDate ?? "—"],
      ]);
      return status;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Show a build's external TestFlight beta review state"));

import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuild } from "../../../application/app-store-versions";
import { betaReviewStatus } from "../../../application/testflight-review";
import { runEffect } from "../../../lib/citty-effect";
import { printHuman, printHumanKeyValue } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface ReviewStatusArgs extends AscCommonArgs {
  readonly build?: string | undefined;
  readonly "build-version"?: string | undefined;
}

export const reviewStatusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show a build's external TestFlight beta review state",
  },
  args: { ...ASC_COMMON_ARGS, ...BUILD_SELECTOR_ARGS },
  run: async ({ args }: { readonly args: ReviewStatusArgs }) =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

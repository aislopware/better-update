import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuild } from "../../../application/app-store-versions";
import { submitBetaReview } from "../../../application/testflight-review";
import { runEffect } from "../../../lib/citty-effect";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface ReviewSubmitArgs extends AscCommonArgs {
  readonly build?: string | undefined;
  readonly "build-version"?: string | undefined;
}

export const reviewSubmitCommand = defineCommand({
  meta: {
    name: "submit",
    description: "Submit a build for external TestFlight beta review (idempotent)",
  },
  args: { ...ASC_COMMON_ARGS, ...BUILD_SELECTOR_ARGS },
  run: async ({ args }: { readonly args: ReviewSubmitArgs }) =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

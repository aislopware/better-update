import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuild } from "../../../application/app-store-versions";
import { withdrawBetaReview } from "../../../application/testflight-review";
import { runEffect } from "../../../lib/citty-effect";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface ReviewWithdrawArgs extends AscCommonArgs {
  readonly build?: string | undefined;
  readonly "build-version"?: string | undefined;
}

export const reviewWithdrawCommand = defineCommand({
  meta: {
    name: "withdraw",
    description: "Withdraw a build's in-flight external TestFlight beta review submission",
  },
  args: { ...ASC_COMMON_ARGS, ...BUILD_SELECTOR_ARGS },
  run: async ({ args }: { readonly args: ReviewWithdrawArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const session = yield* openAscSession(args);
        const build = yield* resolveBuild(session.ctx, session.appId, {
          buildId: args.build,
          buildVersion: args["build-version"],
        });
        const result = yield* withdrawBetaReview(build);
        yield* printHuman(`Withdrew beta review submission for build ${build.attributes.version}.`);
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

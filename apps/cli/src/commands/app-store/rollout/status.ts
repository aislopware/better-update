import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { rolloutStatus } from "../../../application/app-store-rollout";
import { runEffect } from "../../../lib/citty-effect";
import { printHuman } from "../../../lib/output";
import { renderRollout } from "./render";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface RolloutArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
}

export const rolloutStatusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show the phased release progress for the rollout version",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
  },
  run: async ({ args }: { readonly args: RolloutArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const platform = yield* normalizePlatform(args.platform);
        const session = yield* openAscSession(args);
        const view = yield* rolloutStatus(session.ctx, session.appId, platform);
        if (view === null) {
          yield* printHuman("No phased release is configured for this version.");
          return { rollout: null };
        }
        yield* renderRollout(view);
        return { rollout: view };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

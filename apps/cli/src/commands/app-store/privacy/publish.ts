import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { publishPrivacy } from "../../../application/app-store-privacy";
import { runEffect } from "../../../lib/citty-effect";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

export const privacyPublishCommand = defineCommand({
  meta: {
    name: "publish",
    description: "Publish the App Privacy label, making the declared data usages public",
  },
  args: { ...ASC_COMMON_ARGS },
  run: async ({ args }: { readonly args: AscCommonArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const session = yield* openAscSession(args);
        const result = yield* publishPrivacy(session.ctx, session.appId, true);
        yield* printHuman("Published the App Privacy label.");
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

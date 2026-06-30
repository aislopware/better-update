import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { clearPrivacy } from "../../../application/app-store-privacy";
import { runEffect } from "../../../lib/citty-effect";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

export const privacyClearCommand = defineCommand({
  meta: {
    name: "clear",
    description: "Delete every declared App Privacy data usage (re-publish afterwards to apply)",
  },
  args: { ...ASC_COMMON_ARGS },
  run: async ({ args }: { readonly args: AscCommonArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const session = yield* openAscSession(args);
        const result = yield* clearPrivacy(session.ctx, session.appId);
        yield* printHuman(`Cleared ${String(result.cleared)} App Privacy data usage(s).`);
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

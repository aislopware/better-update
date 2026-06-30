import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { getPrivacy } from "../../../application/app-store-privacy";
import { runEffect } from "../../../lib/citty-effect";
import { printHuman, printHumanList } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

export const privacyGetCommand = defineCommand({
  meta: {
    name: "get",
    description: "Show the declared App Privacy data usages and publish state",
  },
  args: { ...ASC_COMMON_ARGS },
  run: async ({ args }: { readonly args: AscCommonArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const session = yield* openAscSession(args);
        const privacy = yield* getPrivacy(session.ctx, session.appId);
        yield* printHuman(
          privacy.published
            ? `App Privacy label is published (last: ${privacy.lastPublished ?? "—"}).`
            : "App Privacy label is not published.",
        );
        yield* printHumanList(
          ["Category", "Protection", "Purpose"],
          privacy.usages.map((usage) => [
            usage.category ?? "—",
            usage.protection ?? "—",
            usage.purpose ?? "—",
          ]),
          "No data usages declared.",
        );
        return privacy;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

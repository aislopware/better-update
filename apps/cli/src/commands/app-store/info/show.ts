import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { showAppInfo } from "../../../application/app-store-info";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanKeyValue, printHumanList } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

export const infoShowCommand = defineCommand({
  meta: {
    name: "show",
    description: "Show the app's store info (state, categories) and per-locale listing",
  },
  args: { ...ASC_COMMON_ARGS },
  run: async ({ args }: { readonly args: AscCommonArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const session = yield* openAscSession(args);
        const info = yield* showAppInfo(session.ctx, session.appId);
        yield* printHumanKeyValue([
          ["App Info", info.appInfoId],
          ["State", info.state ?? "—"],
          ["Primary category", info.primaryCategory ?? "—"],
          ["Secondary category", info.secondaryCategory ?? "—"],
        ]);
        yield* printHumanList(
          ["Locale", "Name", "Subtitle", "Privacy URL"],
          info.localizations.map((loc) => [
            loc.locale,
            loc.name ?? "—",
            loc.subtitle ?? "—",
            loc.privacyPolicyUrl ?? "—",
          ]),
          "No localizations.",
        );
        return info;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

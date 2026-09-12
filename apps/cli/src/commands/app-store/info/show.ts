import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { showAppInfo } from "../../../application/app-store-info";
import { printHumanKeyValue, printHumanList } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const infoShowCommand = Command.make(
  "show",
  {
    ...ASC_COMMON_ARGS,
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription("Show the app's store info (state, categories) and per-locale listing"),
);

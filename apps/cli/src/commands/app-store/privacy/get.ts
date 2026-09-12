import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { getPrivacy } from "../../../application/app-store-privacy";
import { printHuman, printHumanList } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const privacyGetCommand = Command.make(
  "get",
  {
    ...ASC_COMMON_ARGS,
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Show the declared App Privacy data usages and publish state"));

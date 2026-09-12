import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { openCookieContext } from "../../../application/asc-cookie-session";
import { listAscApiKeysViaAppleId } from "../../../lib/credentials-generator-asc-key";
import { printHumanList } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const ascKeyListCommand = Command.make(
  "list",
  {},
  Effect.fn(
    function* () {
      const { ctx } = yield* openCookieContext;
      const keys = yield* listAscApiKeysViaAppleId(ctx);
      yield* printHumanList(
        ["Key id", "Nickname"],
        keys.map((key) => [key.keyId, key.nickname]),
        "No active App Store Connect API keys found on Apple.",
      );
      return { items: keys };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "List the team's active App Store Connect API keys as seen on Apple (Apple ID login; not the local vault)",
  ),
);

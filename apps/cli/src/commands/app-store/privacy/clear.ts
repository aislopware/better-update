import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { clearPrivacy } from "../../../application/app-store-privacy";
import { printHuman } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const privacyClearCommand = Command.make(
  "clear",
  {
    ...ASC_COMMON_ARGS,
  },
  Effect.fn(
    function* (args) {
      const session = yield* openAscSession(args);
      const result = yield* clearPrivacy(session.ctx, session.appId);
      yield* printHuman(`Cleared ${String(result.cleared)} App Privacy data usage(s).`);
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Delete every declared App Privacy data usage (re-publish afterwards to apply)",
  ),
);

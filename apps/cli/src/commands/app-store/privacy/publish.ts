import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { publishPrivacy } from "../../../application/app-store-privacy";
import { printHuman } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const privacyPublishCommand = Command.make(
  "publish",
  {
    ...ASC_COMMON_ARGS,
  },
  Effect.fn(
    function* (args) {
      const session = yield* openAscSession(args);
      const result = yield* publishPrivacy(session.ctx, session.appId, true);
      yield* printHuman("Published the App Privacy label.");
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription("Publish the App Privacy label, making the declared data usages public"),
);

import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { pushConfig } from "../../../application/app-store-config";
import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { readJsonInput } from "../../../lib/json-input";
import { printHuman } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const configPushCommand = Command.make(
  "push",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
    from: Flag.String("from").pipe(
      Flag.withDescription("Config JSON file or inline JSON (from `config pull`)"),
    ),
  },
  Effect.fn(
    function* (args) {
      const from = args.from.trim();
      const document = yield* readJsonInput(from);
      const platform = yield* normalizePlatform(args.platform);
      const session = yield* openAscSession(args);
      const result = yield* pushConfig(session.ctx, session.appId, platform, document);
      yield* printHuman(
        `Applied copy to ${result.applied} locale(s)${
          result.skipped.length > 0 ? `, skipped ${result.skipped.length} with no copy` : ""
        }.`,
      );
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription("Apply a JSON config document's per-locale copy to the editable version"),
);

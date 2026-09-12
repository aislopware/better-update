import { FileSystem, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { pullConfig } from "../../../application/app-store-config";
import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const configPullCommand = Command.make(
  "pull",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
    out: Flag.String("out").pipe(
      Flag.withDescription("Write the JSON document to this file instead of stdout"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const platform = yield* normalizePlatform(args.platform);
      const session = yield* openAscSession(args);
      const doc = yield* pullConfig(session.ctx, session.appId, platform);
      const out = args.out?.trim();
      if (out !== undefined && out.length > 0) {
        yield* (yield* FileSystem.FileSystem)
          .writeFileString(out, JSON.stringify(doc, null, 2))
          .pipe(
            Effect.mapError(
              (cause) =>
                new InvalidArgumentError({
                  message: `Could not write "${out}": ${String(cause)}`,
                }),
            ),
          );
        yield* printHuman(`Wrote config for ${doc.localizations.length} locale(s) to ${out}.`);
      } else {
        yield* printHuman(JSON.stringify(doc, null, 2));
      }
      return doc;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Pull the editable version's per-locale copy into a JSON config document",
  ),
);

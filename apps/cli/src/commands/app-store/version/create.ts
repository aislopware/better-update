import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { ensureVersion } from "../../../application/app-store-versions";
import { printHuman, printHumanKeyValue } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const versionCreateCommand = Command.make(
  "create",
  {
    ...ASC_COMMON_ARGS,
    version: Flag.String("version").pipe(
      Flag.withDescription("Marketing version string to create, e.g. 1.2.0"),
    ),
    platform: ASC_PLATFORM_FLAG,
  },
  Effect.fn(
    function* (args) {
      const platform = yield* normalizePlatform(args.platform);
      const session = yield* openAscSession(args);
      const version = yield* ensureVersion(
        session.ctx,
        session.appId,
        args.version.trim(),
        platform,
      );
      yield* printHuman(`App Store version ${version.versionString} is ready (${version.state}).`);
      yield* printHumanKeyValue([
        ["Version", version.versionString],
        ["Platform", version.platform],
        ["State", version.state],
        ["ID", version.id],
      ]);
      return version;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription("Create (or rename) the editable App Store version for a version string"),
);

import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { listVersions } from "../../../application/app-store-versions";
import { printHumanList } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const versionListCommand = Command.make(
  "list",
  {
    ...ASC_COMMON_ARGS,
  },
  Effect.fn(
    function* (args) {
      const session = yield* openAscSession(args);
      const versions = yield* listVersions(session.ctx, session.appId);
      yield* printHumanList(
        ["Version", "Platform", "State", "ID"],
        versions.map((version) => [
          version.versionString,
          version.platform,
          version.state,
          version.id,
        ]),
        "No App Store versions found for this app.",
      );
      return { items: versions };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("List the App Store versions of an app"));

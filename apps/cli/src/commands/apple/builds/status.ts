import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuild } from "../../../application/app-store-versions";
import { buildStatus } from "../../../application/apple-builds";
import { printHumanKeyValue } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const buildsStatusCommand = Command.make(
  "status",
  {
    ...ASC_COMMON_ARGS,
    ...BUILD_SELECTOR_ARGS,
  },
  Effect.fn(
    function* (args) {
      const session = yield* openAscSession(args);
      const build = yield* resolveBuild(session.ctx, session.appId, {
        buildId: args.build,
        buildVersion: args["build-version"],
      });
      const status = yield* buildStatus(build);
      yield* printHumanKeyValue([
        ["Build", status.version],
        ["Processing", status.processingState],
        ["Encryption", status.usesNonExemptEncryption ? "non-exempt" : "exempt"],
        ["Missing compliance", String(status.missingExportCompliance)],
        ["Internal state", status.internalState ?? "—"],
        ["External state", status.externalState ?? "—"],
        ["Auto-notify", status.autoNotifyEnabled === null ? "—" : String(status.autoNotifyEnabled)],
      ]);
      return status;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Show a build's processing + TestFlight beta status"));

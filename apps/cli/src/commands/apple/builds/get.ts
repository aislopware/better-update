import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuild } from "../../../application/app-store-versions";
import { summarizeBuild } from "../../../application/apple-builds";
import { printHumanKeyValue } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const buildsGetCommand = Command.make(
  "get",
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
      const view = summarizeBuild(build);
      yield* printHumanKeyValue([
        ["Build", view.version],
        ["Version", view.appVersion ?? "—"],
        ["Platform", view.platform ?? "—"],
        ["Processing", view.processingState],
        ["Encryption", view.usesNonExemptEncryption ? "non-exempt" : "exempt"],
        ["Expired", String(view.expired)],
        ["Uploaded", view.uploadedDate],
        ["ID", view.id],
      ]);
      return view;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Show one uploaded build by id or CFBundleVersion"));

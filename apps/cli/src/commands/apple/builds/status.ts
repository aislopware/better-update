import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuild } from "../../../application/app-store-versions";
import { buildStatus } from "../../../application/apple-builds";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanKeyValue } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface BuildsStatusArgs extends AscCommonArgs {
  readonly build?: string | undefined;
  readonly "build-version"?: string | undefined;
}

export const buildsStatusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show a build's processing + TestFlight beta status",
  },
  args: {
    ...ASC_COMMON_ARGS,
    ...BUILD_SELECTOR_ARGS,
  },
  run: async ({ args }: { readonly args: BuildsStatusArgs }) =>
    runEffect(
      Effect.gen(function* () {
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
          [
            "Auto-notify",
            status.autoNotifyEnabled === null ? "—" : String(status.autoNotifyEnabled),
          ],
        ]);
        return status;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

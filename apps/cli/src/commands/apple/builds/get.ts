import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuild } from "../../../application/app-store-versions";
import { summarizeBuild } from "../../../application/apple-builds";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanKeyValue } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface BuildsGetArgs extends AscCommonArgs {
  readonly build?: string | undefined;
  readonly "build-version"?: string | undefined;
}

export const buildsGetCommand = defineCommand({
  meta: {
    name: "get",
    description: "Show one uploaded build by id or CFBundleVersion",
  },
  args: {
    ...ASC_COMMON_ARGS,
    ...BUILD_SELECTOR_ARGS,
  },
  run: async ({ args }: { readonly args: BuildsGetArgs }) =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

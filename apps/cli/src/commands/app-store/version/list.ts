import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { listVersions } from "../../../application/app-store-versions";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanList } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

export const versionListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List the App Store versions of an app",
  },
  args: { ...ASC_COMMON_ARGS },
  run: async ({ args }: { readonly args: AscCommonArgs }) =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

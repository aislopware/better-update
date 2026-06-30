import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { listBuilds } from "../../../application/apple-builds";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanList } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface BuildsListArgs extends AscCommonArgs {
  readonly limit?: string | undefined;
}

export const buildsListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List the app's uploaded App Store Connect builds (newest first)",
  },
  args: {
    ...ASC_COMMON_ARGS,
    limit: { type: "string", default: "50", description: "Max builds to return (default: 50)" },
  },
  run: async ({ args }: { readonly args: BuildsListArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const limit = Number.parseInt(args.limit ?? "50", 10) || 50;
        const session = yield* openAscSession(args);
        const builds = yield* listBuilds(session.ctx, session.appId, limit);
        yield* printHumanList(
          ["Build", "Version", "Platform", "Processing", "Encryption", "Uploaded", "ID"],
          builds.map((build) => [
            build.version,
            build.appVersion ?? "—",
            build.platform ?? "—",
            build.processingState,
            build.usesNonExemptEncryption ? "non-exempt" : "exempt",
            build.uploadedDate,
            build.id,
          ]),
          "No builds found.",
        );
        return { items: builds };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

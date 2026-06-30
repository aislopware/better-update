import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_AUTH_ARGS,
  openAscContext,
} from "../../../application/app-store-connect";
import { listBundleIds } from "../../../application/apple-signing-inventory";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanList } from "../../../lib/output";

import type { AscAuthArgs } from "../../../application/app-store-connect";

export const bundleIdListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List the team's registered App IDs (bundle ids) on App Store Connect (CI-safe)",
  },
  args: {
    ...ASC_AUTH_ARGS,
  },
  run: async ({ args }: { readonly args: AscAuthArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const session = yield* openAscContext(args);
        const bundleIds = yield* listBundleIds(session.ctx);
        yield* printHumanList(
          ["Identifier", "Name", "Platform", "Seed", "ID"],
          bundleIds.map((bundleId) => [
            bundleId.identifier,
            bundleId.name,
            bundleId.platform,
            bundleId.seedId,
            bundleId.id,
          ]),
          "No App IDs found.",
        );
        return { items: bundleIds };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

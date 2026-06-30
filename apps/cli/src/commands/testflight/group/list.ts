import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { listBetaGroups } from "../../../application/testflight-groups";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanList } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

export const groupListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List the TestFlight beta groups for an App Store Connect app",
  },
  args: { ...ASC_COMMON_ARGS },
  run: async ({ args }: { readonly args: AscCommonArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const session = yield* openAscSession(args);
        const groups = yield* listBetaGroups(session.ctx, session.appId);
        yield* printHumanList(
          ["Name", "Type", "ID", "Public link"],
          groups.map((group) => [
            group.name,
            group.internal ? "internal" : "external",
            group.id,
            group.publicLink ?? "—",
          ]),
          "No TestFlight groups found for this app.",
        );
        return { items: groups };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

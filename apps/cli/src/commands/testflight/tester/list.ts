import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { findBetaGroup } from "../../../application/testflight-groups";
import { listTesters } from "../../../application/testflight-testers";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanList } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface TesterListArgs extends AscCommonArgs {
  readonly group?: string | undefined;
  readonly "group-id"?: string | undefined;
}

export const testerListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List TestFlight testers for the app, or a single beta group",
  },
  args: {
    ...ASC_COMMON_ARGS,
    group: { type: "string", description: "Limit to testers in this beta group (by name)" },
    "group-id": { type: "string", description: "Limit to testers in this beta group (by id)" },
  },
  run: async ({ args }: { readonly args: TesterListArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const session = yield* openAscSession(args);
        const scoped = args.group !== undefined || args["group-id"] !== undefined;
        const groupId = scoped
          ? (yield* findBetaGroup(session.ctx, session.appId, {
              id: args["group-id"],
              name: args.group,
            })).id
          : undefined;
        const testers = yield* listTesters(session.ctx, session.appId, groupId);
        yield* printHumanList(
          ["Email", "Name", "State", "Invite", "ID"],
          testers.map((tester) => [
            tester.email ?? "—",
            [tester.firstName, tester.lastName].filter(Boolean).join(" ") || "—",
            tester.state ?? "—",
            tester.inviteType ?? "—",
            tester.id,
          ]),
          "No TestFlight testers found.",
        );
        return { items: testers };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

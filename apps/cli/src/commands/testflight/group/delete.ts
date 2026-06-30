import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { deleteBetaGroup, findBetaGroup } from "../../../application/testflight-groups";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface GroupDeleteArgs extends AscCommonArgs {
  readonly id?: string | undefined;
  readonly name?: string | undefined;
}

export const groupDeleteCommand = defineCommand({
  meta: {
    name: "delete",
    description: "Delete a TestFlight beta group by id or name",
  },
  args: {
    ...ASC_COMMON_ARGS,
    id: { type: "string", description: "Beta group id to delete" },
    name: { type: "string", description: "Beta group name to delete (when no id is given)" },
  },
  run: async ({ args }: { readonly args: GroupDeleteArgs }) =>
    runEffect(
      Effect.gen(function* () {
        if (args.id === undefined && args.name === undefined) {
          return yield* new InvalidArgumentError({ message: "Pass --id or --name." });
        }
        const session = yield* openAscSession(args);
        const group = yield* findBetaGroup(session.ctx, session.appId, {
          id: args.id,
          name: args.name,
        });
        yield* deleteBetaGroup(session.ctx, group.id);
        yield* printHuman(`Deleted TestFlight group "${group.name}" (${group.id}).`);
        return { id: group.id, name: group.name, deleted: true };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

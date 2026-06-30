import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { findBetaGroup } from "../../../application/testflight-groups";
import { removeTester } from "../../../application/testflight-testers";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface TesterRemoveArgs extends AscCommonArgs {
  readonly email?: string | undefined;
  readonly group?: string | undefined;
  readonly "group-id"?: string | undefined;
  readonly delete: boolean;
}

export const testerRemoveCommand = defineCommand({
  meta: {
    name: "remove",
    description: "Remove a tester from a beta group, or delete the tester entirely (--delete)",
  },
  args: {
    ...ASC_COMMON_ARGS,
    email: { type: "string", description: "Tester email address (required)" },
    group: { type: "string", description: "Beta group to remove the tester from (by name)" },
    "group-id": { type: "string", description: "Beta group to remove the tester from (by id)" },
    delete: {
      type: "boolean",
      default: false,
      description: "Delete the tester account entirely (from every group + the app)",
    },
  },
  run: async ({ args }: { readonly args: TesterRemoveArgs }) =>
    runEffect(
      Effect.gen(function* () {
        if (args.email === undefined || args.email.trim().length === 0) {
          return yield* new InvalidArgumentError({ message: "--email is required." });
        }
        const email = args.email.trim();
        const scoped = args.group !== undefined || args["group-id"] !== undefined;
        if (!args.delete && !scoped) {
          return yield* new InvalidArgumentError({
            message:
              "Pass --group/--group-id to remove from a group, or --delete to remove entirely.",
          });
        }
        const session = yield* openAscSession(args);
        const groupId =
          args.delete || !scoped
            ? undefined
            : (yield* findBetaGroup(session.ctx, session.appId, {
                id: args["group-id"],
                name: args.group,
              })).id;
        const result = yield* removeTester(session.ctx, {
          email,
          groupId,
          deleteAccount: args.delete,
        });
        yield* printHuman(
          result.removed === "account"
            ? `Deleted tester ${email}.`
            : `Removed tester ${email} from the beta group.`,
        );
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

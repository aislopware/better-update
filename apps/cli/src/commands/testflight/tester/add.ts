import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { findBetaGroup } from "../../../application/testflight-groups";
import { addTester } from "../../../application/testflight-testers";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface TesterAddArgs extends AscCommonArgs {
  readonly email?: string | undefined;
  readonly "first-name"?: string | undefined;
  readonly "last-name"?: string | undefined;
  readonly group?: string | undefined;
  readonly "group-id"?: string | undefined;
  readonly invite: boolean;
}

export const testerAddCommand = defineCommand({
  meta: {
    name: "add",
    description: "Add a single tester to a TestFlight beta group",
  },
  args: {
    ...ASC_COMMON_ARGS,
    email: { type: "string", description: "Tester email address (required)" },
    "first-name": { type: "string", description: "Tester first name" },
    "last-name": { type: "string", description: "Tester last name" },
    group: { type: "string", description: "Beta group to add the tester to (by name)" },
    "group-id": { type: "string", description: "Beta group to add the tester to (by id)" },
    invite: {
      type: "boolean",
      default: false,
      description: "Email the TestFlight invitation immediately after adding the tester",
    },
  },
  run: async ({ args }: { readonly args: TesterAddArgs }) =>
    runEffect(
      Effect.gen(function* () {
        if (args.email === undefined || args.email.trim().length === 0) {
          return yield* new InvalidArgumentError({ message: "--email is required." });
        }
        if (args.group === undefined && args["group-id"] === undefined) {
          return yield* new InvalidArgumentError({ message: "Pass --group or --group-id." });
        }
        const session = yield* openAscSession(args);
        const group = yield* findBetaGroup(session.ctx, session.appId, {
          id: args["group-id"],
          name: args.group,
        });
        const tester = yield* addTester(session.ctx, session.appId, group.id, {
          email: args.email.trim(),
          firstName: args["first-name"],
          lastName: args["last-name"],
          invite: args.invite,
        });
        yield* printHuman(`Added ${tester.email ?? "tester"} to "${group.name}".`);
        yield* printHumanKeyValue([
          ["Email", tester.email ?? "—"],
          ["Group", group.name],
          ["State", tester.state ?? "—"],
          ["ID", tester.id],
        ]);
        return tester;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

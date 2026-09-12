import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { findBetaGroup } from "../../../application/testflight-groups";
import { addTester } from "../../../application/testflight-testers";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const testerAddCommand = Command.make(
  "add",
  {
    ...ASC_COMMON_ARGS,
    email: Flag.String("email").pipe(Flag.withDescription("Tester email address")),
    "first-name": Flag.String("first-name").pipe(
      Flag.withDescription("Tester first name"),
      optionalFlag,
    ),
    "last-name": Flag.String("last-name").pipe(
      Flag.withDescription("Tester last name"),
      optionalFlag,
    ),
    group: Flag.String("group").pipe(
      Flag.withDescription("Beta group to add the tester to (by name)"),
      optionalFlag,
    ),
    "group-id": Flag.String("group-id").pipe(
      Flag.withDescription("Beta group to add the tester to (by id)"),
      optionalFlag,
    ),
    invite: Flag.Boolean("invite").pipe(
      Flag.withDescription("Email the TestFlight invitation immediately after adding the tester"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Add a single tester to a TestFlight beta group"));

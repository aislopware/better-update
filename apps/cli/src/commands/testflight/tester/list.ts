import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { findBetaGroup } from "../../../application/testflight-groups";
import { listTesters } from "../../../application/testflight-testers";
import { printHumanList } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const testerListCommand = Command.make(
  "list",
  {
    ...ASC_COMMON_ARGS,
    group: Flag.String("group").pipe(
      Flag.withDescription("Limit to testers in this beta group (by name)"),
      optionalFlag,
    ),
    "group-id": Flag.String("group-id").pipe(
      Flag.withDescription("Limit to testers in this beta group (by id)"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("List TestFlight testers for the app, or a single beta group"));

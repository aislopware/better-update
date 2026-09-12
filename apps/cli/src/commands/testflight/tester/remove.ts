import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { findBetaGroup } from "../../../application/testflight-groups";
import { removeTester } from "../../../application/testflight-testers";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const testerRemoveCommand = Command.make(
  "remove",
  {
    ...ASC_COMMON_ARGS,
    email: Flag.String("email").pipe(Flag.withDescription("Tester email address")),
    group: Flag.String("group").pipe(
      Flag.withDescription("Beta group to remove the tester from (by name)"),
      optionalFlag,
    ),
    "group-id": Flag.String("group-id").pipe(
      Flag.withDescription("Beta group to remove the tester from (by id)"),
      optionalFlag,
    ),
    delete: Flag.Boolean("delete").pipe(
      Flag.withDescription("Delete the tester account entirely (from every group + the app)"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Remove a tester from a beta group, or delete the tester entirely (--delete)",
  ),
);

import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { deleteBetaGroup, findBetaGroup } from "../../../application/testflight-groups";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const groupDeleteCommand = Command.make(
  "delete",
  {
    ...ASC_COMMON_ARGS,
    id: Flag.String("id").pipe(Flag.withDescription("Beta group id to delete"), optionalFlag),
    name: Flag.String("name").pipe(
      Flag.withDescription("Beta group name to delete (when no id is given)"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Delete a TestFlight beta group by id or name"));

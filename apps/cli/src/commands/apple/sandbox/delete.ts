import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { deleteSandboxTester } from "../../../application/apple-sandbox";
import { openCookieContext } from "../../../application/asc-cookie-session";
import { printHuman } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const sandboxDeleteCommand = Command.make(
  "delete",
  {
    id: Flag.String("id").pipe(
      Flag.withDescription("Sandbox tester id (from `apple sandbox list`)"),
    ),
  },
  Effect.fn(
    function* (args) {
      const id = args.id.trim();
      const { ctx } = yield* openCookieContext;
      yield* deleteSandboxTester(ctx, id);
      yield* printHuman(`Deleted sandbox tester ${id}.`);
      return { id, deleted: true };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Delete an App Store sandbox tester by id (Apple ID login)"));

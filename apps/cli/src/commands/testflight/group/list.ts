import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { listBetaGroups } from "../../../application/testflight-groups";
import { printHumanList } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const groupListCommand = Command.make(
  "list",
  {
    ...ASC_COMMON_ARGS,
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("List the TestFlight beta groups for an App Store Connect app"));

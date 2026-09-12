import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { ASC_AUTH_ARGS, openAscContext } from "../../../application/app-store-connect";
import { listProfiles } from "../../../application/apple-signing-inventory";
import { printHumanList } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const profileListCommand = Command.make(
  "list",
  {
    ...ASC_AUTH_ARGS,
  },
  Effect.fn(
    function* (args) {
      const session = yield* openAscContext(args);
      const profiles = yield* listProfiles(session.ctx);
      yield* printHumanList(
        ["Name", "Type", "State", "Platform", "Expires", "ID"],
        profiles.map((profile) => [
          profile.name,
          profile.profileType,
          profile.profileState,
          profile.platform,
          profile.expirationDate,
          profile.id,
        ]),
        "No provisioning profiles found.",
      );
      return { items: profiles };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription("List the team's provisioning profiles on App Store Connect (CI-safe)"),
);

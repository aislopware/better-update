import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_AUTH_ARGS,
  openAscContext,
} from "../../../application/app-store-connect";
import { listProfiles } from "../../../application/apple-signing-inventory";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanList } from "../../../lib/output";

import type { AscAuthArgs } from "../../../application/app-store-connect";

export const profileListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List the team's provisioning profiles on App Store Connect (CI-safe)",
  },
  args: {
    ...ASC_AUTH_ARGS,
  },
  run: async ({ args }: { readonly args: AscAuthArgs }) =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

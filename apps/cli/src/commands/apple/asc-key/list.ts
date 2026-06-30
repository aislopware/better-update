import { defineCommand } from "citty";
import { Effect } from "effect";

import { APP_STORE_EXIT_EXTRAS } from "../../../application/app-store-connect";
import { openCookieContext } from "../../../application/asc-cookie-session";
import { runEffect } from "../../../lib/citty-effect";
import { listAscApiKeysViaAppleId } from "../../../lib/credentials-generator-asc-key";
import { printHumanList } from "../../../lib/output";

export const ascKeyListCommand = defineCommand({
  meta: {
    name: "list",
    description:
      "List the team's active App Store Connect API keys as seen on Apple (Apple ID login; not the local vault)",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const { ctx } = yield* openCookieContext;
        const keys = yield* listAscApiKeysViaAppleId(ctx);
        yield* printHumanList(
          ["Key id", "Nickname"],
          keys.map((key) => [key.keyId, key.nickname]),
          "No active App Store Connect API keys found on Apple.",
        );
        return { items: keys };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

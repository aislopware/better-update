import { defineCommand } from "citty";
import { Effect } from "effect";

import { APP_STORE_EXIT_EXTRAS } from "../../../application/app-store-connect";
import { listSandboxTesters } from "../../../application/apple-sandbox";
import { openCookieContext } from "../../../application/asc-cookie-session";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanList } from "../../../lib/output";

export const sandboxListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List the team's App Store sandbox testers (Apple ID login)",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const { ctx } = yield* openCookieContext;
        const testers = yield* listSandboxTesters(ctx);
        yield* printHumanList(
          ["Email", "Name", "Territory", "ID"],
          testers.map((tester) => [
            tester.email,
            `${tester.firstName} ${tester.lastName}`,
            tester.territory ?? "—",
            tester.id,
          ]),
          "No sandbox testers found.",
        );
        return { items: testers };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

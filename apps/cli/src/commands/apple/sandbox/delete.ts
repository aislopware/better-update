import { defineCommand } from "citty";
import { Effect } from "effect";

import { APP_STORE_EXIT_EXTRAS } from "../../../application/app-store-connect";
import { deleteSandboxTester } from "../../../application/apple-sandbox";
import { openCookieContext } from "../../../application/asc-cookie-session";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";

interface SandboxDeleteArgs {
  readonly id?: string | undefined;
}

export const sandboxDeleteCommand = defineCommand({
  meta: {
    name: "delete",
    description: "Delete an App Store sandbox tester by id (Apple ID login)",
  },
  args: {
    id: { type: "string", description: "Sandbox tester id (from `apple sandbox list`) (required)" },
  },
  run: async ({ args }: { readonly args: SandboxDeleteArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const id = args.id?.trim();
        if (id === undefined || id.length === 0) {
          return yield* new InvalidArgumentError({
            message: "--id is required (a tester id from `apple sandbox list`).",
          });
        }
        const { ctx } = yield* openCookieContext;
        yield* deleteSandboxTester(ctx, id);
        yield* printHuman(`Deleted sandbox tester ${id}.`);
        return { id, deleted: true };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

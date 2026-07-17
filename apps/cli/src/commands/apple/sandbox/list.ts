import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_AUTH_ARGS,
  loadSubmitProfile,
} from "../../../application/app-store-connect";
import { listSandboxTesters, listSandboxTestersV2 } from "../../../application/apple-sandbox";
import { openCookieContext } from "../../../application/asc-cookie-session";
import { messageOf } from "../../../lib/apple-asc-connect";
import { planAscAuth } from "../../../lib/asc-auth-plan";
import { fetchAscCredentials } from "../../../lib/asc-credentials";
import { runEffect } from "../../../lib/citty-effect";
import { printHuman, printHumanList } from "../../../lib/output";
import { apiClient } from "../../../services/api-client";
import { CliRuntime } from "../../../services/cli-runtime";

import type { AscAuthArgs } from "../../../application/app-store-connect";

/** The historical Apple ID path — also the fallback when the token path fails. */
const listViaCookie = Effect.gen(function* () {
  const { ctx } = yield* openCookieContext;
  return yield* listSandboxTesters(ctx);
});

/**
 * Token-first path: decrypt the stored ASC API key and read the public
 * `GET /v2/sandboxTesters`. Any failure (declined vault unlock, HTTP error)
 * prints a one-line note and falls back to the cookie path.
 */
const listViaToken = (ascApiKeyId: string) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const credentials = yield* fetchAscCredentials(api, ascApiKeyId);
    return yield* listSandboxTestersV2({ credentials });
  }).pipe(
    Effect.catchAll((error) =>
      printHuman(
        `Could not list sandbox testers with the ASC API key (${messageOf(error)}); falling back to Apple ID login.`,
      ).pipe(Effect.zipRight(listViaCookie)),
    ),
  );

export const sandboxListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List the team's App Store sandbox testers (ASC API key, or Apple ID login)",
  },
  args: {
    ...ASC_AUTH_ARGS,
  },
  run: async ({ args }: { readonly args: AscAuthArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        const projectRoot = yield* runtime.cwd;
        const profile = yield* loadSubmitProfile(projectRoot, args.profile);
        const plan = planAscAuth({
          flagKeyId: args["asc-api-key-id"],
          profileKeyId: profile?.ascApiKeyId,
        });
        const testers =
          plan.mode === "cookie" ? yield* listViaCookie : yield* listViaToken(plan.ascApiKeyId);
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

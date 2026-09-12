import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { printHuman } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
import { AppleAuth } from "../../services/apple-auth";

export const appleLoginCommand = Command.make(
  "login",
  {
    username: Flag.String("username").pipe(
      Flag.withDescription(
        "Apple ID to log in as — restores its cached session when present, otherwise pre-fills the prompt",
      ),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const auth = yield* AppleAuth;
      const session = yield* auth.ensureLoggedIn(compact({ username: args.username }));
      yield* printHuman(
        `Logged in as ${session.username}. Team: ${session.teamName ?? session.teamId} (${session.teamId}).`,
      );
      return session;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Log in to your Apple Developer account (used to issue iOS certificates)",
  ),
);

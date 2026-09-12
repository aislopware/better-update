import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import type { Context } from "effect";

import { printHuman } from "../../../lib/output";
import { optionalArgument } from "../../../lib/params";
import { promptSelect } from "../../../lib/prompts";
import { runCommand } from "../../../lib/run-command";
import { AppleAuth } from "../../../services/apple-auth";
import { AppleSessionStore } from "../../../services/apple-session-store";

/** Sentinel `promptSelect` choice: fall through to a fresh interactive login. */
const FRESH_LOGIN_CHOICE = "__login__";

const resolveTarget = (
  store: Context.Service.Shape<typeof AppleSessionStore>,
  username: string | undefined,
) =>
  Effect.gen(function* () {
    if (username) {
      return username;
    }
    const { active, accounts } = yield* store.listAccounts;
    if (accounts.length === 0) {
      return FRESH_LOGIN_CHOICE;
    }
    return yield* promptSelect("Switch to Apple account", [
      ...accounts.map((account) => ({
        value: account,
        label: account === active ? `${account} (current)` : account,
      })),
      { value: FRESH_LOGIN_CHOICE, label: "Log in with a different Apple ID…" },
    ]);
  });

export const accountsSwitchCommand = Command.make(
  "switch",
  {
    username: Argument.String("username").pipe(
      Argument.withDescription(
        "Apple ID to switch to (prompts with the cached accounts when omitted)",
      ),
      optionalArgument,
    ),
  },
  Effect.fn(
    function* (args) {
      const store = yield* AppleSessionStore;
      const auth = yield* AppleAuth;
      const target = yield* resolveTarget(store, args.username);
      const session = yield* target === FRESH_LOGIN_CHOICE
        ? auth.ensureLoggedIn({ freshLogin: true })
        : auth.ensureLoggedIn({ username: target });
      yield* printHuman(
        `Active Apple account: ${session.username}. Team: ${session.teamName ?? session.teamId} (${session.teamId}).`,
      );
      return session;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Switch the active Apple account (restores its cached session; logs in when needed)",
  ),
);

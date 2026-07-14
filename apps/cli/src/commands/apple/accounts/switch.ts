import { defineCommand } from "citty";
import { Effect } from "effect";

import type { Context } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { printHuman } from "../../../lib/output";
import { promptSelect } from "../../../lib/prompts";
import { AppleAuth } from "../../../services/apple-auth";
import { AppleSessionStore } from "../../../services/apple-session-store";

const SWITCH_EXIT_EXTRAS = {
  AppleAuthError: 4,
  InteractiveProhibitedError: 4,
} as const;

/** Sentinel `promptSelect` choice: fall through to a fresh interactive login. */
const FRESH_LOGIN_CHOICE = "__login__";

const resolveTarget = (
  store: Context.Tag.Service<AppleSessionStore>,
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

export const accountsSwitchCommand = defineCommand({
  meta: {
    name: "switch",
    description:
      "Switch the active Apple account (restores its cached session; logs in when needed)",
  },
  args: {
    username: {
      type: "positional",
      required: false,
      description: "Apple ID to switch to (prompts with the cached accounts when omitted)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { exits: SWITCH_EXIT_EXTRAS, json: "value" },
    ),
});

import { defineCommand } from "citty";
import { Effect } from "effect";

import { activeRecipient } from "../../application/identity";
import { unlockVaultKeyInteractive } from "../../application/vault-access";
import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { VaultCache } from "../../services/vault-cache";

/** Whole minutes left, rounded up so "<1 min remaining" still reads as 1. */
const remainingMinutes = (remainingMs: number): number =>
  Math.max(1, Math.ceil(remainingMs / 60_000));

const unlockCommand = defineCommand({
  meta: {
    name: "unlock",
    description:
      "Unlock the credential vault and cache the key in your OS keychain, so later commands don't re-prompt",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const recipient = yield* activeRecipient;
        if (recipient.source !== "file") {
          yield* printHuman(
            "Active identity is the BETTER_UPDATE_IDENTITY (CI) key — it has no passphrase and isn't cached.",
          );
          return;
        }
        const api = yield* apiClient;
        const cache = yield* VaultCache;
        // Force a fresh unlock: drop any live entry first so the interactive
        // unlock prompts and re-caches, rather than silently reusing the old key.
        yield* cache.clear(recipient.publicKey);
        yield* unlockVaultKeyInteractive(api);
        const cached = yield* cache.get(recipient.publicKey);
        const suffix =
          cached === undefined
            ? " (no OS keychain available — commands will keep prompting)"
            : ` for ~${remainingMinutes(cached.remainingMs)} min; run \`better-update credentials lock\` to clear it`;
        yield* printHuman(`Vault unlocked${suffix}.`);
      }),
    ),
});

const lockCommand = defineCommand({
  meta: {
    name: "lock",
    description: "Forget the cached vault key — the next credential command will prompt again",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const recipient = yield* activeRecipient;
        const cache = yield* VaultCache;
        yield* cache.clear(recipient.publicKey);
        yield* printHuman("Vault locked — the cached key was cleared from your OS keychain.");
      }),
    ),
});

const statusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show whether the vault is currently unlocked (cached) and for how much longer",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const recipient = yield* activeRecipient;
        if (recipient.source !== "file") {
          yield* printHuman(
            "Active identity is the BETTER_UPDATE_IDENTITY (CI) key — caching not used.",
          );
          return;
        }
        const cache = yield* VaultCache;
        const cached = yield* cache.get(recipient.publicKey);
        yield* printHuman(
          cached === undefined
            ? "Locked — the next credential command will prompt for your passphrase."
            : `Unlocked — cached vault key expires in ~${remainingMinutes(cached.remainingMs)} min.`,
        );
      }),
    ),
});

export { lockCommand, statusCommand, unlockCommand };

import { defineCommand } from "citty";
import { Effect } from "effect";

import { activeRecipient } from "../../application/identity";
import { unlockVaultKeyInteractive } from "../../application/vault-access";
import { runEffect } from "../../lib/citty-effect";
import { formatDurationApprox, parseDurationMs } from "../../lib/duration";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import {
  VAULT_CACHE_TTL_MAX_MS,
  VAULT_CACHE_TTL_MIN_MS,
  VaultCache,
} from "../../services/vault-cache";

/** Parse + bound the `--duration` flag; `undefined` (flag absent) keeps the 15-minute default. */
const resolveUnlockTtlMs = (flag: string | undefined) =>
  Effect.gen(function* () {
    if (flag === undefined) {
      return undefined;
    }
    const ms = parseDurationMs(flag);
    if (ms === undefined) {
      return yield* new InvalidArgumentError({
        message: `Could not parse --duration "${flag}" — use minutes ("90") or h/m units ("45m", "2h", "1h30m").`,
      });
    }
    if (ms < VAULT_CACHE_TTL_MIN_MS || ms > VAULT_CACHE_TTL_MAX_MS) {
      return yield* new InvalidArgumentError({
        message: `--duration must be between ${formatDurationApprox(VAULT_CACHE_TTL_MIN_MS)} and ${formatDurationApprox(VAULT_CACHE_TTL_MAX_MS)}, got "${flag}".`,
      });
    }
    return ms;
  });

const unlockCommand = defineCommand({
  meta: {
    name: "unlock",
    description:
      "Unlock the credential vault and cache the key in your OS keychain, so later commands don't re-prompt",
  },
  args: {
    duration: {
      type: "string",
      description:
        'How long to stay unlocked — minutes ("90") or h/m units ("45m", "2h", "1h30m"); default 15m, max 24h',
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const cacheTtlMs = yield* resolveUnlockTtlMs(args.duration);
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
        yield* unlockVaultKeyInteractive(api, { cacheTtlMs });
        const cached = yield* cache.get(recipient.publicKey);
        const suffix =
          cached === undefined
            ? " (no OS keychain available — commands will keep prompting)"
            : ` for ~${formatDurationApprox(cached.remainingMs)}; run \`better-update credentials lock\` to clear it`;
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
            : `Unlocked — cached vault key expires in ~${formatDurationApprox(cached.remainingMs)}.`,
        );
      }),
    ),
});

export { lockCommand, statusCommand, unlockCommand };

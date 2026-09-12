import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { getActiveOrgId } from "../../application/credential-cipher";
import { activeRecipient } from "../../application/identity";
import { unlockVaultKeyInteractive } from "../../application/vault-access";
import { formatDurationApprox, parseDurationMs } from "../../lib/duration";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
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

const unlockCommand = Command.make(
  "unlock",
  {
    duration: Flag.String("duration").pipe(
      Flag.withDescription(
        'How long to stay unlocked — minutes ("90") or h/m units ("45m", "2h", "1h30m"); default 15m, max 24h',
      ),
      optionalFlag,
    ),
  },
  Effect.fn(function* (args) {
    const cacheTtlMs = yield* resolveUnlockTtlMs(args.duration);
    const recipient = yield* activeRecipient;
    if (recipient.source !== "file") {
      yield* printHuman(
        "Active identity is a robot (CI) key — it has no passphrase and isn't cached.",
      );
      return;
    }
    const api = yield* apiClient;
    const orgId = yield* getActiveOrgId(api);
    const cache = yield* VaultCache;
    const key = { orgId, publicKey: recipient.publicKey };
    // Force a fresh unlock: drop any live entry first so the interactive
    // unlock prompts and re-caches, rather than silently reusing the old key.
    yield* cache.clear(key);
    yield* unlockVaultKeyInteractive(api, { orgId, cacheTtlMs });
    const cached = yield* cache.get(key);
    const suffix =
      cached === undefined
        ? " (no OS keychain available — commands will keep prompting)"
        : ` for ~${formatDurationApprox(cached.remainingMs)}; run \`better-update credentials lock\` to clear it`;
    yield* printHuman(`Vault unlocked${suffix}.`);
  }, runCommand()),
).pipe(
  Command.withDescription(
    "Unlock the credential vault and cache the key in your OS keychain, so later commands don't re-prompt",
  ),
);

const lockCommand = Command.make(
  "lock",
  {},
  Effect.fn(function* () {
    const recipient = yield* activeRecipient;
    const api = yield* apiClient;
    const orgId = yield* getActiveOrgId(api);
    const cache = yield* VaultCache;
    yield* cache.clear({ orgId, publicKey: recipient.publicKey });
    yield* printHuman("Vault locked — the cached key was cleared from your OS keychain.");
  }, runCommand()),
).pipe(
  Command.withDescription(
    "Forget the cached vault key — the next credential command will prompt again",
  ),
);

const statusCommand = Command.make(
  "status",
  {},
  Effect.fn(function* () {
    const recipient = yield* activeRecipient;
    if (recipient.source !== "file") {
      yield* printHuman("Active identity is a robot (CI) key — caching not used.");
      return;
    }
    const api = yield* apiClient;
    const orgId = yield* getActiveOrgId(api);
    const cache = yield* VaultCache;
    const cached = yield* cache.get({ orgId, publicKey: recipient.publicKey });
    yield* printHuman(
      cached === undefined
        ? "Locked — the next credential command will prompt for your passphrase."
        : `Unlocked — cached vault key expires in ~${formatDurationApprox(cached.remainingMs)}.`,
    );
  }, runCommand()),
).pipe(
  Command.withDescription(
    "Show whether the vault is currently unlocked (cached) and for how much longer",
  ),
);

export { lockCommand, statusCommand, unlockCommand };
